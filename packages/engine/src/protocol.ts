import type { Action } from './game';
import type { PlayerView } from './view';

/** Messages échangés entre le navigateur et le serveur (Socket.IO). */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const TURN_SECONDS_OPTIONS = [15, 30, 45, 60, 0] as const; // 0 = sans limite
export const NAME_MAX_LENGTH = 16;

export interface RoomPlayer {
  id: string;
  name: string;
  connected: boolean;
  /** Regarde encore l'écran de fin de la partie précédente. */
  inResults: boolean;
}

export const CHAT_MAX_LENGTH = 200;
export const CHAT_HISTORY = 60;

export interface ChatMessage {
  id: number;
  /** Id du joueur, ou null pour un message du salon (arrivée, départ…). */
  from: string | null;
  name: string;
  text: string;
  at: number;
}

export interface RoomSettings {
  /** Temps par action en secondes, 0 = illimité. */
  turnSeconds: number;
}

export interface RoomView {
  code: string;
  you: string;
  hostId: string;
  players: RoomPlayer[];
  settings: RoomSettings;
  status: 'lobby' | 'playing';
  lastDurakId: string | null;
  game: PlayerView | null;
  /** Heure limite (ms epoch) de l'action en cours, null si pas de minuteur. */
  deadline: number | null;
  /** Heure du serveur à l'envoi, pour corriger le décalage d'horloge du client. */
  serverNow: number;
  /** Ids des joueurs de la partie, dans l'ordre des places (pour relier vue de jeu et salon). */
  gamePlayerIds: string[];
  chat: ChatMessage[];
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface Session {
  code: string;
  playerId: string;
  token: string;
}

export interface ClientToServer {
  'room:create': (p: { name: string }, ack: (r: Ack<Session>) => void) => void;
  'room:join': (p: { code: string; name: string }, ack: (r: Ack<Session>) => void) => void;
  'room:resume': (p: { code: string; token: string }, ack: (r: Ack<Session>) => void) => void;
  'room:leave': () => void;
  'room:settings': (p: Partial<RoomSettings>, ack: (r: Ack) => void) => void;
  'room:reorder': (p: { order: string[] }, ack: (r: Ack) => void) => void;
  'room:start': (ack: (r: Ack) => void) => void;
  'room:toLobby': (ack: (r: Ack) => void) => void;
  'game:action': (a: Action, ack: (r: Ack) => void) => void;
  'chat:send': (p: { text: string }, ack: (r: Ack) => void) => void;
}

export interface ServerToClient {
  'room:state': (r: RoomView) => void;
  'room:closed': (reason: string) => void;
}
