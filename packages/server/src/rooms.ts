import { randomBytes, randomInt } from 'node:crypto';
import {
  type Action,
  CHAT_HISTORY,
  CHAT_MAX_LENGTH,
  type ChatMessage,
  type GameState,
  type Profile,
  type RoomSettings,
  type RoomView,
  type StatsSummary,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX_LENGTH,
  PLAYER_COLORS,
  TURN_SECONDS_OPTIONS,
  applyAction,
  createGame,
  sanitizeAction,
  timeoutAction,
  viewFor,
} from '@durak/engine';
import type { AccountStore } from './accounts';
import { censor, containsVulgarity } from './censor';

/** Délai accordé à un joueur déconnecté avant que le serveur joue à sa place. */
const DISCONNECTED_TURN_SECONDS = 15;
/** Un salon sans aucun joueur connecté est supprimé après ce délai. */
const IDLE_ROOM_MS = 10 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Temps laissé à l'annonce de l'atout avant que le minuteur de la première action démarre. */
export const INTRO_DELAY_MS = 4500;
/** Délai de grâce après un redémarrage du serveur, le temps que les joueurs se reconnectent. */
const RESTORE_GRACE_MS = 20_000;

export interface Member {
  id: string;
  token: string;
  name: string;
  connected: boolean;
  /** A quitté le salon pendant une partie : retiré à la fin de celle-ci. */
  left: boolean;
  /** Regarde encore l'écran de fin de partie (pas revenu au salon). */
  inResults: boolean;
  /** Horodatages des derniers messages, pour limiter le flood. */
  chatTimes: number[];
  color: number;
  /** Compte du joueur, null pour un invité. */
  profileId: string | null;
  avatarUrl: string | null;
  stats: StatsSummary | null;
  /** Statistiques avant/après la dernière partie, pour l'écran de fin. */
  delta: { before: StatsSummary; after: StatsSummary } | null;
}

/** Identité d'un joueur connecté à un compte, au moment de créer ou rejoindre un salon. */
export interface AccountIdentity {
  profile: Profile;
}

export interface Room {
  code: string;
  hostId: string;
  members: Member[];
  settings: RoomSettings;
  game: GameState | null;
  gamePlayerIds: string[];
  gameColors: number[];
  lastDurakId: string | null;
  /** Pseudo du dernier durak : le reconnaît s'il a quitté puis rejoint le salon. */
  lastDurakName: string | null;
  deadline: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  idleSince: number | null;
  chat: ChatMessage[];
  chatSeq: number;
  /** Début de la partie en cours (pour l'historique). */
  startedAt: number | null;
}

export class RoomError extends Error {}

export function normalizeCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length === 6 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
}

export function cleanName(name: unknown): string {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
  if (!n) throw new RoomError('Choisis un pseudo.');
  if (containsVulgarity(n)) throw new RoomError('Ce pseudo n’est pas accepté. Choisis-en un autre.');
  return n;
}

const newId = () => randomBytes(8).toString('hex');
const newMember = (name: string, color = 0, account?: AccountIdentity): Member => ({
  id: newId(),
  token: newId() + newId(),
  name,
  connected: true,
  left: false,
  inResults: false,
  chatTimes: [],
  color,
  profileId: account?.profile.id ?? null,
  avatarUrl: account?.profile.avatarUrl ?? null,
  stats: null,
  delta: null,
});

/** Première couleur libre du salon. */
const freeColor = (room: Room) => {
  const used = new Set(room.members.filter((m) => !m.left).map((m) => m.color));
  for (let c = 0; c < PLAYER_COLORS; c++) if (!used.has(c)) return c;
  return 0;
};

export class Rooms {
  private rooms = new Map<string, Room>();

  /**
   * `notify` est appelé à chaque changement d'un salon, pour diffuser l'état aux joueurs.
   * `store` (facultatif) : comptes et statistiques ; sans lui, tout le monde joue en invité.
   */
  constructor(
    private notify: (room: Room) => void,
    private store: AccountStore | null = null,
  ) {}

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

  create(name: string, account?: AccountIdentity): { room: Room; member: Member } {
    const member: Member = account
      ? newMember(account.profile.username, account.profile.color, account)
      : newMember(cleanName(name));
    const room: Room = {
      code: this.newCode(),
      hostId: member.id,
      members: [member],
      settings: { turnSeconds: 30 },
      game: null,
      gamePlayerIds: [],
      gameColors: [],
      lastDurakId: null,
      lastDurakName: null,
      deadline: null,
      timer: null,
      idleSince: null,
      chat: [],
      chatSeq: 0,
      startedAt: null,
    };
    this.rooms.set(room.code, room);
    this.refreshStats(room);
    return { room, member };
  }

  join(code: string, name: string, account?: AccountIdentity): { room: Room; member: Member } {
    const room = this.get(code);
    if (!room) throw new RoomError('Aucun salon avec ce code. Vérifie les 6 caractères.');
    // Un compte déjà présent (autre appareil, onglet fermé) retrouve sa place.
    const already = account && room.members.find((m) => m.profileId === account.profile.id && !m.left);
    if (already) {
      already.connected = true;
      room.idleSince = null;
      this.schedule(room);
      this.notify(room);
      return { room, member: already };
    }
    if (room.game && room.game.phase !== 'finished')
      throw new RoomError('Une partie est en cours dans ce salon. Réessaie à la fin.');
    const clean = account ? account.profile.username : cleanName(name);
    if (room.members.length >= MAX_PLAYERS) throw new RoomError('Ce salon est complet (6 joueurs).');
    if (room.members.some((m) => m.name.toLowerCase() === clean.toLowerCase()))
      throw new RoomError('Ce pseudo est déjà pris dans ce salon.');
    const taken = new Set(room.members.filter((m) => !m.left).map((m) => m.color));
    const color = account && !taken.has(account.profile.color) ? account.profile.color : freeColor(room);
    const member = newMember(clean, color, account);
    room.members.push(member);
    room.idleSince = null;
    this.system(room, `${clean} a rejoint le salon.`);
    this.notify(room);
    this.refreshStats(room);
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
    // Un joueur déconnecté ne bloque pas la partie suivante.
    m.inResults = false;
    if (!room.members.some((x) => x.connected)) room.idleSince = Date.now();
    this.closeResultsIfDone(room);
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
    this.system(room, `${m.name} a quitté le salon.`);
    this.afterMembershipChange(room);
  }

  private afterMembershipChange(room: Room) {
    const present = room.members.filter((m) => !m.left);
    if (present.length === 0) {
      this.close(room);
      return;
    }
    if (!present.some((m) => m.id === room.hostId)) {
      room.hostId = present[0].id;
      this.system(room, `${present[0].name} est maintenant l’hôte du salon.`);
    }
    if (!room.members.some((x) => x.connected)) room.idleSince = Date.now();
    this.closeResultsIfDone(room);
    this.schedule(room);
    this.notify(room);
  }

  /** Quand plus personne ne regarde l'écran de fin, le salon redevient un salon d'attente. */
  private closeResultsIfDone(room: Room) {
    if (room.game?.phase !== 'finished' || room.members.some((m) => m.inResults)) return;
    room.game = null;
    room.gamePlayerIds = [];
    room.gameColors = [];
    this.dropLeavers(room);
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
    if (room.game && room.game.phase !== 'finished') throw new RoomError('Impossible pendant une partie.');
    const ids = room.members.map((m) => m.id);
    if (order.length !== ids.length || !ids.every((id) => order.includes(id)))
      throw new RoomError('Ordre des places invalide.');
    room.members = order.map((id) => room.members.find((m) => m.id === id)!);
    this.notify(room);
  }

  start(room: Room, by: string) {
    this.requireHost(room, by);
    if (room.game && room.game.phase !== 'finished') throw new RoomError('Une partie est déjà en cours.');
    const waiting = room.members.filter((m) => m.inResults).map((m) => m.name);
    if (waiting.length) throw new RoomError(`En attente de ${waiting.join(', ')}, qui regarde encore les résultats.`);
    room.game = null;
    room.gamePlayerIds = [];
    this.dropLeavers(room);
    if (room.members.length < MIN_PLAYERS) throw new RoomError('Il faut au moins 2 joueurs pour lancer la partie.');
    room.gamePlayerIds = room.members.map((m) => m.id);
    room.gameColors = room.members.map((m) => m.color);
    // Le durak de la partie précédente défend en premier, même s'il a quitté puis rejoint le salon.
    const durak =
      room.members.find((m) => m.id === room.lastDurakId) ??
      room.members.find((m) => room.lastDurakName && m.name.toLowerCase() === room.lastDurakName.toLowerCase());
    room.game = createGame(
      room.members.map((m) => ({ id: m.id, name: m.name })),
      { previousDurakId: durak?.id ?? null },
    );
    room.startedAt = Date.now();
    for (const m of room.members) m.delta = null;
    // Le minuteur de la première action attend la fin de l'annonce de l'atout.
    this.schedule(room, INTRO_DELAY_MS);
    this.notify(room);
  }

  /** Le joueur quitte l'écran de fin et revient au salon d'attente. */
  toLobby(room: Room, by: string) {
    if (room.game && room.game.phase !== 'finished') throw new RoomError('La partie n’est pas terminée.');
    const m = room.members.find((x) => x.id === by);
    if (m) m.inResults = false;
    this.closeResultsIfDone(room);
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
      room.lastDurakName = r.state.durak === null ? null : r.state.players[r.state.durak].name;
      // Chacun garde l'écran de fin jusqu'à ce qu'il revienne lui-même au salon.
      for (const m of room.members) m.inResults = m.connected && !m.left && room.gamePlayerIds.includes(m.id);
      this.recordGame(room, r.state);
      this.closeResultsIfDone(room);
    }
    this.schedule(room);
    this.notify(room);
  }

  /** (Re)programme le minuteur de l'action en cours, avec un délai supplémentaire éventuel. */
  private schedule(room: Room, extraMs = 0) {
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
    const ms = seconds * 1000 + extraMs;
    room.deadline = Date.now() + ms;
    room.timer = setTimeout(() => this.onTimeout(room), ms);
  }

  // -------------------------------------------------------------------------
  // Comptes et statistiques (asynchrone, ne bloque jamais la partie)
  // -------------------------------------------------------------------------

  /** Recharge les statistiques des comptes présents dans le salon. */
  private async refreshStats(room: Room) {
    const ids = room.members.map((m) => m.profileId).filter((x): x is string => !!x);
    if (!this.store || ids.length === 0) return;
    try {
      const stats = await this.store.stats(ids);
      for (const m of room.members) if (m.profileId) m.stats = stats.get(m.profileId) ?? m.stats;
      if (this.rooms.has(room.code)) this.notify(room);
    } catch (e) {
      console.error('Statistiques indisponibles :', e);
    }
  }

  /** Enregistre la partie terminée, puis calcule l'évolution des stats de chaque compte. */
  private async recordGame(room: Room, g: GameState) {
    const seats = room.gamePlayerIds.map((id) => room.members.find((m) => m.id === id) ?? null);
    const ids = seats.map((m) => m?.profileId).filter((x): x is string => !!x);
    if (!this.store || ids.length === 0) return;
    try {
      const before = await this.store.stats(ids);
      await this.store.recordGame({
        roomCode: room.code,
        startedAt: new Date(room.startedAt ?? Date.now()),
        endedAt: new Date(),
        rounds: g.round,
        trumpSuit: g.trumpSuit,
        withBots: false,
        players: g.players.map((p, seat) => ({
          seat,
          profileId: seats[seat]?.profileId ?? null,
          name: p.name,
          place: p.place,
          isKorol: p.place === 0,
          isDurak: g.durak === seat,
          cardsLeft: p.hand.length,
        })),
      });
      const after = await this.store.stats(ids);
      for (const m of room.members) {
        if (!m.profileId || !after.has(m.profileId)) continue;
        m.stats = after.get(m.profileId)!;
        m.delta = { before: before.get(m.profileId)!, after: m.stats };
      }
      if (this.rooms.has(room.code)) this.notify(room);
    } catch (e) {
      console.error('Impossible d’enregistrer la partie :', e);
    }
  }

  // -------------------------------------------------------------------------
  // Sauvegarde et reprise au redémarrage du serveur
  // -------------------------------------------------------------------------

  /** État de tous les salons, prêt à être écrit sur disque. */
  snapshot(): string {
    const rooms = [...this.rooms.values()].map(({ timer: _timer, ...rest }) => rest);
    return JSON.stringify({ version: 1, savedAt: Date.now(), rooms });
  }

  /** Recharge les salons sauvegardés. Les joueurs ont un délai de grâce pour revenir. */
  restore(json: string): number {
    const data = JSON.parse(json) as { version: number; rooms: Omit<Room, 'timer'>[] };
    if (data.version !== 1) return 0;
    for (const saved of data.rooms) {
      const room: Room = { ...saved, timer: null, idleSince: Date.now() };
      for (const m of room.members) {
        m.connected = false;
        m.chatTimes = [];
      }
      this.rooms.set(room.code, room);
      this.schedule(room, RESTORE_GRACE_MS);
    }
    return data.rooms.length;
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

  /** L'hôte retire un joueur du salon (hors partie en cours). Renvoie le joueur retiré. */
  kick(room: Room, by: string, targetId: string): Member {
    this.requireHost(room, by);
    if (room.game && room.game.phase !== 'finished') throw new RoomError('Impossible de retirer un joueur pendant une partie.');
    if (targetId === by) throw new RoomError('Tu ne peux pas te retirer toi-même : utilise « Quitter ».');
    const target = room.members.find((m) => m.id === targetId && !m.left);
    if (!target) throw new RoomError('Ce joueur n’est plus dans le salon.');
    room.members = room.members.filter((m) => m.id !== targetId);
    this.system(room, `${target.name} a été retiré du salon par l’hôte.`);
    this.afterMembershipChange(room);
    return target;
  }

  setColor(room: Room, by: string, color: number) {
    const m = room.members.find((x) => x.id === by);
    if (!m) throw new RoomError('Tu n’es pas dans ce salon.');
    if (!Number.isInteger(color) || color < 0 || color >= PLAYER_COLORS) throw new RoomError('Couleur invalide.');
    if (room.members.some((x) => x.id !== by && !x.left && x.color === color))
      throw new RoomError('Cette couleur est déjà prise.');
    m.color = color;
    this.notify(room);
  }

  /** Message d'un joueur, censuré et limité contre le flood. */
  chat(room: Room, memberId: string, raw: unknown) {
    const m = room.members.find((x) => x.id === memberId);
    if (!m) throw new RoomError('Tu n’es pas dans ce salon.');
    const text = String(raw ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CHAT_MAX_LENGTH);
    if (!text) return;
    const now = Date.now();
    m.chatTimes = m.chatTimes.filter((t) => now - t < 10_000);
    if (m.chatTimes.length >= 5) throw new RoomError('Doucement : attends quelques secondes avant d’écrire.');
    m.chatTimes.push(now);
    this.post(room, { from: m.id, name: m.name, text: censor(text) });
    this.notify(room);
  }

  private system(room: Room, text: string) {
    this.post(room, { from: null, name: '', text });
  }

  private post(room: Room, msg: Omit<ChatMessage, 'id' | 'at'>) {
    room.chat.push({ ...msg, id: ++room.chatSeq, at: Date.now() });
    if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
  }

  /** Supprime les salons abandonnés. */
  sweep(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (room.idleSince !== null && now - room.idleSince > IDLE_ROOM_MS) this.close(room);
    }
  }

  viewFor(room: Room, memberId: string): RoomView {
    const seat = room.gamePlayerIds.indexOf(memberId);
    const me = room.members.find((m) => m.id === memberId);
    const playing = !!room.game && (room.game.phase !== 'finished' || !!me?.inResults);
    return {
      code: room.code,
      you: memberId,
      hostId: room.hostId,
      players: room.members
        .filter((m) => !m.left)
        .map((m) => ({
          id: m.id,
          name: m.name,
          connected: m.connected,
          inResults: m.inResults,
          color: m.color,
          profileId: m.profileId,
          avatarUrl: m.avatarUrl,
          stats: m.stats,
        })),
      settings: room.settings,
      status: playing ? 'playing' : 'lobby',
      lastDurakId: room.lastDurakId,
      game: playing ? viewFor(room.game!, seat) : null,
      deadline: room.deadline,
      serverNow: Date.now(),
      gamePlayerIds: room.gamePlayerIds,
      gameColors: room.gameColors,
      chat: room.chat,
      myDelta: me?.delta ?? null,
    };
  }
}
