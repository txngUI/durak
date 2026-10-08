import type { PublicConfig } from '@durak/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Connexion Supabase côté navigateur. La configuration (URL + clé publique) est servie par le
 * serveur de jeu : sans projet Supabase configuré, les comptes sont simplement désactivés.
 */
let client: SupabaseClient | null = null;

export async function initSupabase(): Promise<SupabaseClient | null> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    const cfg = (await res.json()) as PublicConfig;
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      // Bibliothèque chargée seulement si les comptes sont activés : le jeu invité reste léger.
      const { createClient } = await import('@supabase/supabase-js');
      client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        // Flux « implicit » : la session revient dans le #fragment de l'URL, ce qui laisse
        // le paramètre ?code= libre pour les liens d'invitation.
        auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
  } catch {
    client = null;
  }
  return client;
}

export const supabase = () => client;

/** Adresse de retour après connexion Discord/Google ou clic dans un e-mail : la page actuelle. */
export const returnUrl = () => `${location.origin}${location.pathname}${location.search}`;

// ---------------------------------------------------------------------------
// Lectures publiques : profil, historique, classement
// ---------------------------------------------------------------------------

export interface ProfileStats {
  id: string;
  username: string;
  color: number;
  avatar_url: string | null;
  games: number;
  korol: number;
  durak: number;
  created_at?: string;
}

export interface HistoryEntry {
  endedAt: string;
  playerCount: number;
  place: number | null;
  isKorol: boolean;
  isDurak: boolean;
  others: string[];
}

export interface BoardRow {
  rank: number;
  id: string;
  username: string;
  color: number;
  avatar_url: string | null;
  games: number;
  korol: number;
  durak: number;
}

export const MIN_RANKED_GAMES = 10;

export async function fetchProfile(id: string): Promise<{ stats: ProfileStats; createdAt: string | null; rank: number | null } | null> {
  if (!client) return null;
  const [{ data: stats }, { data: prof }, { data: board }] = await Promise.all([
    client.from('player_stats').select('id, username, color, avatar_url, games, korol, durak').eq('id', id).maybeSingle(),
    client.from('profiles').select('created_at').eq('id', id).maybeSingle(),
    client.rpc('leaderboard', { min_games: MIN_RANKED_GAMES }),
  ]);
  if (!stats) return null;
  const rank = ((board ?? []) as BoardRow[]).find((r) => r.id === id)?.rank ?? null;
  return { stats: stats as ProfileStats, createdAt: prof?.created_at ?? null, rank: rank === null ? null : Number(rank) };
}

export async function fetchHistory(id: string, limit = 20): Promise<HistoryEntry[]> {
  if (!client) return [];
  const { data } = await client.rpc('player_history', { p_id: id, max_rows: limit });
  type Row = { ended_at: string; player_count: number; place: number | null; is_korol: boolean; is_durak: boolean; others: string[] };
  return ((data ?? []) as Row[]).map((r) => ({
    endedAt: r.ended_at,
    playerCount: r.player_count,
    place: r.place,
    isKorol: r.is_korol,
    isDurak: r.is_durak,
    others: r.others ?? [],
  }));
}

export async function fetchLeaderboard(order: 'korol' | 'durak', monthOnly: boolean): Promise<BoardRow[]> {
  if (!client) return [];
  const since = monthOnly ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString() : null;
  const { data } = await client.rpc('leaderboard', { order_by: order, since, min_games: MIN_RANKED_GAMES });
  return ((data ?? []) as BoardRow[]).map((r) => ({ ...r, rank: Number(r.rank) }));
}
