import type { Profile, StatsSummary } from '@durak/engine';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import {
  type AccountStore,
  type GameRecord,
  type Identity,
  MIN_RANKED_GAMES,
  UsernameTakenError,
  emptyStats,
} from './accounts';

type ProfileRow = { id: string; username: string; color: number; avatar_url: string | null };
const toProfile = (r: ProfileRow): Profile => ({ id: r.id, username: r.username, color: r.color, avatarUrl: r.avatar_url });

/**
 * Comptes et statistiques dans Supabase. Utilise la clé service : ce code ne tourne
 * que sur le serveur de jeu, jamais dans le navigateur.
 */
export class SupabaseAccountStore implements AccountStore {
  private db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async verifyToken(token: string): Promise<Identity | null> {
    const { data, error } = await this.db.auth.getUser(token);
    if (error || !data.user) return null;
    const meta = data.user.user_metadata ?? {};
    const suggested = meta.user_name ?? meta.preferred_username ?? meta.full_name ?? meta.name ?? null;
    return {
      userId: data.user.id,
      suggestedName: typeof suggested === 'string' ? suggested : null,
      avatarUrl: typeof meta.avatar_url === 'string' ? meta.avatar_url : null,
    };
  }

  async getProfile(userId: string) {
    const { data, error } = await this.db.from('profiles').select('id, username, color, avatar_url').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data ? toProfile(data) : null;
  }

  async saveProfile(userId: string, d: { username: string; color: number; avatarUrl: string | null }) {
    const { data, error } = await this.db
      .from('profiles')
      .upsert({ id: userId, username: d.username, color: d.color, avatar_url: d.avatarUrl })
      .select('id, username, color, avatar_url')
      .single();
    // 23505 : violation d'unicité (pseudo déjà pris).
    if (error?.code === '23505') throw new UsernameTakenError();
    if (error) throw error;
    return toProfile(data);
  }

  async isUsernameTaken(username: string, exceptUserId?: string) {
    let q = this.db.from('profiles').select('id').ilike('username', username.replace(/[%_\\]/g, '\\$&'));
    if (exceptUserId) q = q.neq('id', exceptUserId);
    const { data, error } = await q.limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async stats(userIds: string[]) {
    const out = new Map<string, StatsSummary>(userIds.map((id) => [id, emptyStats()]));
    if (userIds.length === 0) return out;
    const [{ data: rows, error }, { data: board, error: boardError }] = await Promise.all([
      this.db.from('player_stats').select('id, games, korol, durak').in('id', userIds),
      this.db.rpc('leaderboard', { min_games: MIN_RANKED_GAMES }),
    ]);
    if (error) throw error;
    if (boardError) throw boardError;
    for (const r of rows ?? []) out.set(r.id, { games: r.games, korol: r.korol, durak: r.durak, rank: null });
    for (const b of (board ?? []) as { id: string; rank: number }[]) {
      const s = out.get(b.id);
      if (s) s.rank = Number(b.rank);
    }
    return out;
  }

  async recordGame(r: GameRecord) {
    const { data: game, error } = await this.db
      .from('games')
      .insert({
        room_code: r.roomCode,
        started_at: r.startedAt.toISOString(),
        ended_at: r.endedAt.toISOString(),
        player_count: r.players.length,
        rounds: r.rounds,
        trump_suit: r.trumpSuit,
        with_bots: r.withBots,
      })
      .select('id')
      .single();
    if (error) throw error;
    const { error: playersError } = await this.db.from('game_players').insert(
      r.players.map((p) => ({
        game_id: game.id,
        seat: p.seat,
        profile_id: p.profileId,
        display_name: p.name,
        place: p.place,
        is_korol: p.isKorol,
        is_durak: p.isDurak,
        cards_left: p.cardsLeft,
      })),
    );
    if (playersError) throw playersError;
  }
}
