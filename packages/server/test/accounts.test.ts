import { type Action, type Profile, viewFor } from '@durak/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryAccountStore } from '../src/accounts';
import { INTRO_DELAY_MS, type Room, Rooms } from '../src/rooms';

const profile = (id: string, username: string, color = 0): Profile => ({ id, username, color, avatarUrl: null });
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const store = new MemoryAccountStore();
  const rooms = new Rooms(() => {}, store);
  return { store, rooms };
}

/** Termine la partie : chacun défend s'il peut, sinon ramasse, et ne relance jamais. */
function finish(room: Room, rooms: Rooms) {
  for (let i = 0; i < 5000 && room.game!.phase !== 'finished'; i++) {
    const g = room.game!;
    const actorId = room.gamePlayerIds[g.actor];
    const v = viewFor(g, g.actor);
    const action: Action = v.legal.chooseTargets.length
      ? { type: 'chooseAttacker', target: v.legal.chooseTargets[0] }
      : v.legal.defend.length
        ? { type: 'defend', card: v.legal.defend[0] }
        : v.legal.canTake
          ? { type: 'take' }
          : v.legal.canPass
            ? { type: 'pass' }
            : { type: 'attack', card: v.legal.attack[0] };
    rooms.act(room, actorId, action);
  }
}

afterEach(() => vi.useRealTimers());

describe('comptes', () => {
  it('un compte rejoint avec son pseudo et sa couleur, et retrouve sa place depuis un autre appareil', () => {
    const { rooms } = setup();
    const { room } = rooms.create('Hôte');
    const tanguy = profile('u1', 'Tanguy', 4);
    const first = rooms.join(room.code, 'ignoré', { profile: tanguy });
    expect(first.member).toMatchObject({ name: 'Tanguy', color: 4, profileId: 'u1' });
    const again = rooms.join(room.code, 'ignoré', { profile: tanguy });
    expect(again.member.id).toBe(first.member.id);
    expect(room.members).toHaveLength(2);
  });

  it('enregistre la partie et donne à chaque compte ses stats avant/après', async () => {
    const { store, rooms } = setup();
    const { room, member: host } = rooms.create('x', { profile: profile('u1', 'Tanguy') });
    rooms.join(room.code, 'Invité');
    rooms.start(room, host.id);
    finish(room, rooms);
    expect(room.game!.phase).toBe('finished');
    await flush();
    await flush();
    expect(store.games).toHaveLength(1);
    const rec = store.games[0];
    expect(rec.players.map((p) => p.profileId)).toEqual(['u1', null]);
    expect(rec.players.filter((p) => p.isDurak)).toHaveLength(1);
    const view = rooms.viewFor(room, host.id);
    expect(view.myDelta?.before.games).toBe(0);
    expect(view.myDelta?.after.games).toBe(1);
    expect(view.players[0].stats?.games).toBe(1);
    expect(view.players[1].stats).toBeNull();
  });

  it('classe les comptes à partir de 10 parties, au % de Korol', async () => {
    const store = new MemoryAccountStore();
    const game = (korol: string, durak: string) => ({
      roomCode: 'AAA-AAA',
      startedAt: new Date(),
      endedAt: new Date(),
      rounds: 10,
      trumpSuit: 'H',
      withBots: false,
      players: [
        { seat: 0, profileId: korol, name: korol, place: 0, isKorol: true, isDurak: false, cardsLeft: 0 },
        { seat: 1, profileId: durak, name: durak, place: null, isKorol: false, isDurak: true, cardsLeft: 3 },
      ],
    });
    for (let i = 0; i < 7; i++) await store.recordGame(game('a', 'b'));
    for (let i = 0; i < 3; i++) await store.recordGame(game('b', 'a'));
    const s = await store.stats(['a', 'b', 'c']);
    expect(s.get('a')).toEqual({ games: 10, korol: 7, durak: 3, rank: 1 });
    expect(s.get('b')).toEqual({ games: 10, korol: 3, durak: 7, rank: 2 });
    expect(s.get('c')).toEqual({ games: 0, korol: 0, durak: 0, rank: null });
  });
});

describe('minuteur et redémarrage', () => {
  it('la première action attend la fin de l’annonce de l’atout', () => {
    vi.useFakeTimers();
    const rooms = new Rooms(() => {});
    const { room, member } = rooms.create('A');
    rooms.join(room.code, 'B');
    const now = Date.now();
    rooms.start(room, member.id);
    expect(room.deadline).toBe(now + 30_000 + INTRO_DELAY_MS);
  });

  it('sauvegarde les salons et les reprend après redémarrage, partie comprise', () => {
    vi.useFakeTimers();
    const before = new Rooms(() => {});
    const { room, member: a } = before.create('A');
    const { member: b } = before.join(room.code, 'B');
    before.start(room, a.id);
    before.chat(room, b.id, 'on reprend ?');
    const json = before.snapshot();

    const after = new Rooms(() => {});
    expect(after.restore(json)).toBe(1);
    const restored = after.get(room.code)!;
    expect(restored.game).toEqual(room.game);
    expect(restored.members.every((m) => !m.connected)).toBe(true);
    expect(restored.chat.at(-1)?.text).toBe('on reprend ?');
    // Le joueur revient avec son jeton, comme après une coupure.
    const { member } = after.resume(room.code, b.token);
    expect(member.id).toBe(b.id);
    expect(after.viewFor(restored, b.id).game?.hand).toHaveLength(6);
  });
});
