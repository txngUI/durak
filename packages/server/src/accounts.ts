import type { Profile, StatsSummary } from '@durak/engine';

/** Identité vérifiée d'un joueur connecté (à partir de son jeton Supabase). */
export interface Identity {
  userId: string;
  /** Nom fourni par Discord/Google, proposé comme pseudo. */
  suggestedName: string | null;
  avatarUrl: string | null;
}

export interface GameRecord {
  roomCode: string;
  startedAt: Date;
  endedAt: Date;
  rounds: number;
  trumpSuit: string;
  withBots: boolean;
  players: {
    seat: number;
    profileId: string | null;
    name: string;
    place: number | null;
    isKorol: boolean;
    isDurak: boolean;
    cardsLeft: number;
  }[];
}

export class UsernameTakenError extends Error {}

/**
 * Tout ce qui touche aux comptes et aux statistiques.
 * Implémenté par Supabase en production, en mémoire pour les tests.
 */
export interface AccountStore {
  verifyToken(token: string): Promise<Identity | null>;
  getProfile(userId: string): Promise<Profile | null>;
  /** Crée ou met à jour le profil. Lève UsernameTakenError si le pseudo est pris. */
  saveProfile(userId: string, data: { username: string; color: number; avatarUrl: string | null }): Promise<Profile>;
  /** Un compte utilise-t-il déjà ce pseudo (casse ignorée) ? */
  isUsernameTaken(username: string, exceptUserId?: string): Promise<boolean>;
  stats(userIds: string[]): Promise<Map<string, StatsSummary>>;
  recordGame(record: GameRecord): Promise<void>;
}

export const MIN_RANKED_GAMES = 10;
export const emptyStats = (): StatsSummary => ({ games: 0, korol: 0, durak: 0, rank: null });

/** Implémentation en mémoire : tests, et développement sans projet Supabase. */
export class MemoryAccountStore implements AccountStore {
  /** Jetons de test : jeton -> identité. */
  tokens = new Map<string, Identity>();
  profiles = new Map<string, Profile>();
  games: GameRecord[] = [];

  async verifyToken(token: string) {
    return this.tokens.get(token) ?? null;
  }

  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }

  async saveProfile(userId: string, data: { username: string; color: number; avatarUrl: string | null }) {
    if (await this.isUsernameTaken(data.username, userId)) throw new UsernameTakenError();
    const profile: Profile = { id: userId, username: data.username, color: data.color, avatarUrl: data.avatarUrl };
    this.profiles.set(userId, profile);
    return profile;
  }

  async isUsernameTaken(username: string, exceptUserId?: string) {
    const key = username.toLowerCase();
    return [...this.profiles.values()].some((p) => p.id !== exceptUserId && p.username.toLowerCase() === key);
  }

  async stats(userIds: string[]) {
    const all = new Map<string, StatsSummary>();
    for (const g of this.games) {
      if (g.withBots) continue;
      for (const p of g.players) {
        if (!p.profileId) continue;
        const s = all.get(p.profileId) ?? emptyStats();
        s.games++;
        if (p.isKorol) s.korol++;
        if (p.isDurak) s.durak++;
        all.set(p.profileId, s);
      }
    }
    const ranked = [...all.entries()]
      .filter(([, s]) => s.games >= MIN_RANKED_GAMES)
      .sort(([, a], [, b]) => b.korol / b.games - a.korol / a.games || b.games - a.games);
    ranked.forEach(([id], i) => (all.get(id)!.rank = i + 1));
    return new Map(userIds.map((id) => [id, all.get(id) ?? emptyStats()]));
  }

  async recordGame(record: GameRecord) {
    this.games.push(record);
  }
}
