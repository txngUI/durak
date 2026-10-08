import type { Action } from './game';
import type { PlayerView } from './view';

/** Messages échangés entre le navigateur et le serveur (Socket.IO). */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const TURN_SECONDS_OPTIONS = [15, 30, 45, 60, 0] as const; // 0 = sans limite
export const NAME_MAX_LENGTH = 16;
/** Nombre de couleurs d'avatar proposées (assez pour 6 joueurs avec du choix). */
export const PLAYER_COLORS = 8;

/** Résumé des statistiques d'un compte (les parties avec bots ne comptent pas). */
export interface StatsSummary {
  games: number;
  korol: number;
  durak: number;
  /** Place au classement (% de Korol, à partir de 10 parties), null si pas encore classé. */
  rank: number | null;
}

export interface Profile {
  id: string;
  username: string;
  color: number;
  avatarUrl: string | null;
}

/** Ce que le navigateur sait de sa connexion côté serveur de jeu. */
export interface AuthState {
  signedIn: boolean;
  /** null : connecté mais pseudo pas encore choisi. */
  profile: Profile | null;
  /** Pseudo proposé à la création du profil (nom Discord/Google). */
  suggestedName: string | null;
}

/** Configuration publique servie par le serveur (`/config.json`). */
export interface PublicConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
}

export interface RoomPlayer {
  id: string;
  name: string;
  connected: boolean;
  /** Regarde encore l'écran de fin de la partie précédente. */
  inResults: boolean;
  /** Couleur d'avatar choisie (0 à PLAYER_COLORS - 1), unique dans le salon. */
  color: number;
  /** Joueur connecté à un compte (sinon invité). */
  profileId: string | null;
  avatarUrl: string | null;
  stats: StatsSummary | null;
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
  /** Couleur de chaque place de la partie (même pour un joueur parti). */
  gameColors: number[];
  chat: ChatMessage[];
  /** Tes statistiques avant et après la dernière partie (comptes seulement). */
  myDelta: { before: StatsSummary; after: StatsSummary } | null;
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
  'room:kick': (p: { playerId: string }, ack: (r: Ack) => void) => void;
  'room:color': (p: { color: number }, ack: (r: Ack) => void) => void;
  'room:start': (ack: (r: Ack) => void) => void;
  'room:toLobby': (ack: (r: Ack) => void) => void;
  'game:action': (a: Action, ack: (r: Ack) => void) => void;
  'chat:send': (p: { text: string }, ack: (r: Ack) => void) => void;
  /** Le navigateur transmet son jeton Supabase (null à la déconnexion). */
  'auth:set': (p: { token: string | null }, ack: (r: Ack<AuthState>) => void) => void;
  'profile:save': (p: { username: string; color: number }, ack: (r: Ack<AuthState>) => void) => void;
}

export interface ServerToClient {
  'room:state': (r: RoomView) => void;
  'room:closed': (reason: string) => void;
}
