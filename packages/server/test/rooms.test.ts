import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Room, Rooms, normalizeCode } from '../src/rooms';

const setup = () => {
  const notified: Room[] = [];
  const rooms = new Rooms((r) => notified.push(r));
  return { rooms, notified };
};

afterEach(() => vi.useRealTimers());

describe('salons', () => {
  it('crée un salon avec un code de 6 caractères et le rejoint par ce code', () => {
    const { rooms } = setup();
    const { room, member: host } = rooms.create('Tanguy');
    expect(room.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    expect(room.hostId).toBe(host.id);
    const { member } = rooms.join(room.code.replace('-', '').toLowerCase(), 'Léa');
    expect(room.members.map((m) => m.name)).toEqual(['Tanguy', 'Léa']);
    expect(member.token).not.toBe(member.id);
  });

  it('normalise les codes saisis', () => {
    expect(normalizeCode(' k7p 2qx ')).toBe('K7P-2QX');
    expect(normalizeCode('k7p-2qx')).toBe('K7P-2QX');
  });

  it('refuse code inconnu, pseudo pris, salon complet', () => {
    const { rooms } = setup();
    const { room } = rooms.create('A');
    expect(() => rooms.join('ZZZ-ZZZ', 'B')).toThrow(/Aucun salon/);
    expect(() => rooms.join(room.code, 'a')).toThrow(/déjà pris/);
    for (const n of ['B', 'C', 'D', 'E', 'F']) rooms.join(room.code, n);
    expect(() => rooms.join(room.code, 'G')).toThrow(/complet/);
  });

  it('seul l’hôte lance la partie, à 2 joueurs minimum', () => {
    const { rooms } = setup();
    const { room, member: host } = rooms.create('A');
    expect(() => rooms.start(room, host.id)).toThrow(/au moins 2/);
    const { member: b } = rooms.join(room.code, 'B');
    expect(() => rooms.start(room, b.id)).toThrow(/hôte/);
    rooms.start(room, host.id);
    expect(room.game).not.toBeNull();
    expect(() => rooms.join(room.code, 'C')).toThrow(/partie est en cours/);
  });

  it('chaque joueur ne voit que sa main', () => {
    const { rooms } = setup();
    const { room, member: a } = rooms.create('A');
    const { member: b } = rooms.join(room.code, 'B');
    rooms.start(room, a.id);
    const va = rooms.viewFor(room, a.id);
    const vb = rooms.viewFor(room, b.id);
    expect(va.game!.hand).toEqual(expect.arrayContaining(room.game!.players[0].hand));
    expect(vb.game!.hand).toEqual(expect.arrayContaining(room.game!.players[1].hand));
    expect(JSON.stringify(va)).not.toContain(b.token);
  });

  it('rejette les actions mal formées ou hors tour', () => {
    const { rooms } = setup();
    const { room, member: a } = rooms.create('A');
    const { member: b } = rooms.join(room.code, 'B');
    rooms.start(room, a.id);
    const g = room.game!;
    const notActor = g.actor === 0 ? b.id : a.id;
    const actor = g.actor === 0 ? a.id : b.id;
    expect(() => rooms.act(room, actor, { type: 'attack', card: { r: 99, s: 'X' } })).toThrow(/invalide/);
    expect(() => rooms.act(room, actor, 'n’importe quoi')).toThrow(/invalide/);
    expect(() => rooms.act(room, notActor, { type: 'take' })).toThrow(/pas à toi/);
  });

  it('joue à la place du joueur quand le temps est écoulé', () => {
    vi.useFakeTimers();
    const { rooms } = setup();
    const { room, member: a } = rooms.create('A');
    rooms.join(room.code, 'B');
    rooms.start(room, a.id);
    const round = room.game!.round;
    const before = room.game!.log.length;
    expect(room.deadline).not.toBeNull();
    vi.advanceTimersByTime(30_000);
    expect(room.game!.log.length).toBeGreaterThan(before);
    expect(room.game!.round).toBe(round);
  });

  it('reprend sa place après une coupure avec son jeton', () => {
    const { rooms } = setup();
    const { room, member: a } = rooms.create('A');
    rooms.disconnect(room, a.id);
    expect(room.members[0].connected).toBe(false);
    const { member } = rooms.resume(room.code, a.token);
    expect(member.id).toBe(a.id);
    expect(member.connected).toBe(true);
    expect(() => rooms.resume(room.code, 'faux')).toThrow();
  });

  it('transmet l’hôte et ferme le salon vide', () => {
    const { rooms } = setup();
    const { room, member: a } = rooms.create('A');
    const { member: b } = rooms.join(room.code, 'B');
    rooms.leave(room, a.id);
    expect(room.hostId).toBe(b.id);
    rooms.leave(room, b.id);
    expect(rooms.get(room.code)).toBeUndefined();
  });

  it('le durak de la partie précédente défend en premier à la revanche', () => {
    const { rooms } = setup();
    const { room, member: a } = rooms.create('A');
    const { member: b } = rooms.join(room.code, 'B');
    room.lastDurakId = b.id;
    rooms.start(room, a.id);
    expect(room.game!.defender).toBe(1);
  });

  it('chacun garde l’écran de fin jusqu’à son retour au salon, l’hôte attend tout le monde', () => {
    const { rooms } = setup();
    const { room, member: a } = rooms.create('A');
    const { member: b } = rooms.join(room.code, 'B');
    rooms.start(room, a.id);
    // Fin de partie simulée : B est le durak.
    room.game = { ...room.game!, phase: 'finished', durak: 1, actor: -1 };
    for (const m of room.members) m.inResults = true;

    rooms.toLobby(room, a.id);
    expect(rooms.viewFor(room, a.id).status).toBe('lobby');
    expect(rooms.viewFor(room, b.id).status).toBe('playing');
    expect(rooms.viewFor(room, a.id).players.find((p) => p.id === b.id)?.inResults).toBe(true);
    expect(() => rooms.start(room, a.id)).toThrow(/En attente de B/);

    // Un nouveau venu peut rejoindre pendant que B regarde encore les résultats.
    rooms.join(room.code, 'C');
    rooms.toLobby(room, b.id);
    expect(room.game).toBeNull();
    rooms.start(room, a.id);
    expect(room.game!.players).toHaveLength(3);
  });

  it('un joueur déconnecté sur l’écran de fin ne bloque pas la suite', () => {
    const { rooms } = setup();
    const { room, member: a } = rooms.create('A');
    const { member: b } = rooms.join(room.code, 'B');
    rooms.start(room, a.id);
    room.game = { ...room.game!, phase: 'finished', durak: 0, actor: -1 };
    for (const m of room.members) m.inResults = true;
    rooms.toLobby(room, a.id);
    rooms.disconnect(room, b.id);
    expect(room.game).toBeNull();
    expect(() => rooms.start(room, a.id)).not.toThrow();
  });
});
