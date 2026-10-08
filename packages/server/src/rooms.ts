import { randomBytes, randomInt } from 'node:crypto';
import {
  type Action,
  type GameState,
  type RoomSettings,
  type RoomView,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX_LENGTH,
  TURN_SECONDS_OPTIONS,
  applyAction,
  createGame,
  sanitizeAction,
  timeoutAction,
  viewFor,
} from '@durak/engine';

/** Délai accordé à un joueur déconnecté avant que le serveur joue à sa place. */
const DISCONNECTED_TURN_SECONDS = 15;
/** Un salon sans aucun joueur connecté est supprimé après ce délai. */
const IDLE_ROOM_MS = 10 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface Member {
  id: string;
  token: string;
  name: string;
  connected: boolean;
  /** A quitté le salon pendant une partie : retiré à la fin de celle-ci. */
  left: boolean;
}

export interface Room {
  code: string;
  hostId: string;
  members: Member[];
  settings: RoomSettings;
  game: GameState | null;
  gamePlayerIds: string[];
  lastDurakId: string | null;
  deadline: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  idleSince: number | null;
}

export class RoomError extends Error {}

export function normalizeCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length === 6 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
}

function cleanName(name: unknown): string {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
  if (!n) throw new RoomError('Choisis un pseudo.');
  return n;
}

const newId = () => randomBytes(8).toString('hex');

export class Rooms {
  private rooms = new Map<string, Room>();

  /** `notify` est appelé à chaque changement d'un salon, pour diffuser l'état aux joueurs. */
  constructor(private notify: (room: Room) => void) {}

  get(code: string) {
    return this.rooms.get(normalizeCode(code));
  }

  private newCode(): string {
    for (;;) {
      let raw = '';
      for (let i = 0; i < 6; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      const code = normalizeCode(raw);
      if (!this.rooms.has(code)) return code;
    }
  }

  create(name: string): { room: Room; member: Member } {
    const member: Member = { id: newId(), token: newId() + newId(), name: cleanName(name), connected: true, left: false };
    const room: Room = {
      code: this.newCode(),
      hostId: member.id,
      members: [member],
      settings: { turnSeconds: 30 },
      game: null,
      gamePlayerIds: [],
      lastDurakId: null,
      deadline: null,
      timer: null,
      idleSince: null,
    };
    this.rooms.set(room.code, room);
    return { room, member };
  }

  join(code: string, name: string): { room: Room; member: Member } {
    const room = this.get(code);
    if (!room) throw new RoomError('Aucun salon avec ce code. Vérifie les 6 caractères.');
    if (room.game) throw new RoomError('Une partie est en cours dans ce salon. Réessaie à la fin.');
    const clean = cleanName(name);
    if (room.members.length >= MAX_PLAYERS) throw new RoomError('Ce salon est complet (6 joueurs).');
    if (room.members.some((m) => m.name.toLowerCase() === clean.toLowerCase()))
      throw new RoomError('Ce pseudo est déjà pris dans ce salon.');
    const member: Member = { id: newId(), token: newId() + newId(), name: clean, connected: true, left: false };
    room.members.push(member);
    room.idleSince = null;
    this.notify(room);
    return { room, member };
  }

  resume(code: string, token: string): { room: Room; member: Member } {
    const room = this.get(code);
    const member = room?.members.find((m) => m.token === token && !m.left);
    if (!room || !member) throw new RoomError('Ce salon n’existe plus.');
    member.connected = true;
    room.idleSince = null;
    this.schedule(room);
    this.notify(room);
    return { room, member };
  }

  disconnect(room: Room, memberId: string) {
    const m = room.members.find((x) => x.id === memberId);
    if (!m) return;
    m.connected = false;
    if (!room.members.some((x) => x.connected)) room.idleSince = Date.now();
    this.schedule(room);
    this.notify(room);
  }

  leave(room: Room, memberId: string) {
    const m = room.members.find((x) => x.id === memberId);
    if (!m) return;
    if (room.game && room.game.phase !== 'finished' && room.gamePlayerIds.includes(memberId)) {
      // En pleine partie, le siège reste : le serveur jouera à sa place.
      m.left = true;
      m.connected = false;
    } else {
      room.members = room.members.filter((x) => x.id !== memberId);
    }
    this.afterMembershipChange(room);
  }

  private afterMembershipChange(room: Room) {
    const present = room.members.filter((m) => !m.left);
    if (present.length === 0) {
      this.close(room);
      return;
    }
    if (!present.some((m) => m.id === room.hostId)) room.hostId = present[0].id;
    if (!room.members.some((x) => x.connected)) room.idleSince = Date.now();
    this.schedule(room);
    this.notify(room);
  }

  close(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    this.rooms.delete(room.code);
  }

  updateSettings(room: Room, by: string, patch: Partial<RoomSettings>) {
    this.requireHost(room, by);
    if (room.game && room.game.phase !== 'finished') throw new RoomError('Impossible pendant une partie.');
    if (patch.turnSeconds !== undefined) {
      if (!(TURN_SECONDS_OPTIONS as readonly number[]).includes(patch.turnSeconds))
        throw new RoomError('Durée de tour invalide.');
      room.settings.turnSeconds = patch.turnSeconds;
    }
    this.notify(room);
  }

  reorder(room: Room, by: string, order: string[]) {
    this.requireHost(room, by);
    if (room.game) throw new RoomError('Impossible pendant une partie.');
    const ids = room.members.map((m) => m.id);
    if (order.length !== ids.length || !ids.every((id) => order.includes(id)))
      throw new RoomError('Ordre des places invalide.');
    room.members = order.map((id) => room.members.find((m) => m.id === id)!);
    this.notify(room);
  }

  start(room: Room, by: string) {
    this.requireHost(room, by);
    if (room.game && room.game.phase !== 'finished') throw new RoomError('Une partie est déjà en cours.');
    this.dropLeavers(room);
    if (room.members.length < MIN_PLAYERS) throw new RoomError('Il faut au moins 2 joueurs pour lancer la partie.');
    room.gamePlayerIds = room.members.map((m) => m.id);
    room.game = createGame(
      room.members.map((m) => ({ id: m.id, name: m.name })),
      { previousDurakId: room.lastDurakId },
    );
    this.schedule(room);
    this.notify(room);
  }

  toLobby(room: Room, by: string) {
    this.requireHost(room, by);
    if (room.game && room.game.phase !== 'finished') throw new RoomError('La partie n’est pas terminée.');
    room.game = null;
    room.gamePlayerIds = [];
    this.dropLeavers(room);
    this.schedule(room);
    this.notify(room);
  }

  act(room: Room, memberId: string, input: unknown) {
    const g = room.game;
    if (!g) throw new RoomError('Aucune partie en cours.');
    const seat = room.gamePlayerIds.indexOf(memberId);
    if (seat < 0) throw new RoomError('Tu ne participes pas à cette partie.');
    const action = sanitizeAction(input);
    if (!action) throw new RoomError('Action invalide.');
    this.apply(room, seat, action);
  }

  private apply(room: Room, seat: number, action: Action) {
    const r = applyAction(room.game!, seat, action);
    if (!r.ok) throw new RoomError(r.error);
    room.game = r.state;
    if (r.state.phase === 'finished') {
      room.lastDurakId = r.state.durak === null ? null : room.gamePlayerIds[r.state.durak];
    }
    this.schedule(room);
    this.notify(room);
  }

  /** (Re)programme le minuteur de l'action en cours. */
  private schedule(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.deadline = null;
    const g = room.game;
    if (!g || g.phase === 'finished') return;
    const actor = room.members.find((m) => m.id === room.gamePlayerIds[g.actor]);
    const away = !actor || !actor.connected;
    let seconds = room.settings.turnSeconds;
    if (away) seconds = seconds ? Math.min(seconds, DISCONNECTED_TURN_SECONDS) : DISCONNECTED_TURN_SECONDS;
    if (!seconds) return;
    room.deadline = Date.now() + seconds * 1000;
    room.timer = setTimeout(() => this.onTimeout(room), seconds * 1000);
  }

  private onTimeout(room: Room) {
    room.timer = null;
    const g = room.game;
    if (!g || g.phase === 'finished' || !this.rooms.has(room.code)) return;
    const action = timeoutAction(g);
    if (!action) return;
    try {
      this.apply(room, g.actor, action);
    } catch {
      // L'action automatique ne peut pas échouer en pratique ; on évite juste de faire tomber le serveur.
    }
  }

  private dropLeavers(room: Room) {
    room.members = room.members.filter((m) => !m.left);
    if (room.members.length && !room.members.some((m) => m.id === room.hostId)) room.hostId = room.members[0].id;
  }

  private requireHost(room: Room, by: string) {
    if (room.hostId !== by) throw new RoomError('Seul l’hôte du salon peut faire ça.');
  }

  /** Supprime les salons abandonnés. */
  sweep(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (room.idleSince !== null && now - room.idleSince > IDLE_ROOM_MS) this.close(room);
    }
  }

  viewFor(room: Room, memberId: string): RoomView {
    const seat = room.gamePlayerIds.indexOf(memberId);
    return {
      code: room.code,
      you: memberId,
      hostId: room.hostId,
      players: room.members
        .filter((m) => !m.left)
        .map((m) => ({ id: m.id, name: m.name, connected: m.connected })),
      settings: room.settings,
      status: room.game ? 'playing' : 'lobby',
      lastDurakId: room.lastDurakId,
      game: room.game ? viewFor(room.game, seat) : null,
      deadline: room.deadline,
      serverNow: Date.now(),
      gamePlayerIds: room.gamePlayerIds,
    };
  }
}
