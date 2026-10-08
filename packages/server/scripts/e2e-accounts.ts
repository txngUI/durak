/**
 * Test de bout en bout des comptes, contre le vrai projet Supabase et le serveur de jeu local.
 * Crée deux comptes de test (sans e-mail envoyé), leur fait choisir un pseudo, joue une partie
 * complète, vérifie ce qui est enregistré, puis supprime tout ce qu'il a créé.
 *
 *   npx tsx --env-file=.env packages/server/scripts/e2e-accounts.ts
 *
 * Les clés sont lues dans .env et ne sont jamais affichées.
 */
import { randomBytes } from 'node:crypto';
import type { Action, Ack, AuthState, ClientToServer, RoomView, ServerToClient, Session } from '@durak/engine';
import { createClient } from '@supabase/supabase-js';
import { io, type Socket } from 'socket.io-client';

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GAME = process.env.DURAK_URL ?? 'http://localhost:3000';
if (!URL || !ANON || !SERVICE) throw new Error('Les trois variables SUPABASE_… doivent être dans .env');

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const tag = randomBytes(3).toString('hex');
const results: [string, boolean, string?][] = [];
const check = (label: string, ok: boolean, detail?: string) => results.push([label, ok, detail]);

type S = Socket<ServerToClient, ClientToServer>;
const call = <T extends object>(fn: (ack: (r: Ack<T>) => void) => void) =>
  new Promise<Ack<T>>((resolve) => fn(resolve));

async function makeUser(letter: string) {
  const email = `durak-e2e-${tag}-${letter}@example.com`;
  const password = randomBytes(12).toString('hex');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, token: s.session!.access_token };
}

function connect(token: string | null) {
  const socket: S = io(GAME, { transports: ['websocket'], auth: { token } });
  let last: RoomView | null = null;
  const waiters: [(r: RoomView) => boolean, (r: RoomView) => void][] = [];
  socket.on('room:state', (r) => {
    last = r;
    for (const w of [...waiters]) if (w[0](r)) (waiters.splice(waiters.indexOf(w), 1), w[1](r));
  });
  const until = (pred: (r: RoomView) => boolean, ms = 20000) =>
    new Promise<RoomView>((resolve, reject) => {
      if (last && pred(last)) return resolve(last);
      const t = setTimeout(() => reject(new Error('délai dépassé')), ms);
      waiters.push([pred, (r) => (clearTimeout(t), resolve(r))]);
    });
  return { socket, until, get room() { return last; } };
}

const users: string[] = [];
let roomCode: string | null = null;
try {
  const a = await makeUser('a');
  const b = await makeUser('b');
  users.push(a.id, b.id);

  // Connexion et choix du pseudo.
  const A = connect(a.token);
  const B = connect(b.token);
  const authA = await call<AuthState>((ack) => A.socket.emit('auth:set', { token: a.token }, ack));
  check('jeton reconnu par le serveur', authA.ok && authA.signedIn && authA.profile === null);
  const nameA = `TestA${tag}`.slice(0, 16);
  const nameB = `TestB${tag}`.slice(0, 16);
  const saveA = await call<AuthState>((ack) => A.socket.emit('profile:save', { username: nameA, color: 3 }, ack));
  check('pseudo enregistré', saveA.ok && saveA.profile?.username === nameA);
  const dup = await call<AuthState>((ack) => B.socket.emit('profile:save', { username: nameA.toLowerCase(), color: 1 }, ack));
  check('pseudo déjà pris refusé', !dup.ok, dup.ok ? '' : dup.error);
  const vulgar = await call<AuthState>((ack) => B.socket.emit('profile:save', { username: 'Connard', color: 1 }, ack));
  check('pseudo vulgaire refusé', !vulgar.ok);
  await call<AuthState>((ack) => B.socket.emit('auth:set', { token: b.token }, ack));
  const saveB = await call<AuthState>((ack) => B.socket.emit('profile:save', { username: nameB, color: 5 }, ack));
  check('second pseudo enregistré', saveB.ok);

  // Un invité ne peut pas prendre le pseudo d'un compte.
  const G = connect(null);
  await new Promise((r) => G.socket.on('connect', () => r(null)));

  // Salon : A crée, B rejoint.
  const created = await call<Session>((ack) => A.socket.emit('room:create', { name: 'ignoré' }, ack));
  if (!created.ok) throw new Error(created.error);
  roomCode = created.code;
  const guest = await call<Session>((ack) => G.socket.emit('room:join', { code: roomCode!, name: nameA }, ack));
  check('invité avec le pseudo d’un compte refusé', !guest.ok, guest.ok ? '' : guest.error);
  G.socket.close();
  const joined = await call<Session>((ack) => B.socket.emit('room:join', { code: roomCode!, name: 'ignoré' }, ack));
  check('compte rejoint le salon', joined.ok);
  const lobby = await A.until((r) => r.players.length === 2 && r.players.every((p) => p.stats));
  check('badges et stats dans le salon', lobby.players.every((p) => p.profileId && p.stats?.games === 0));
  check('couleur du profil reprise', lobby.players[0].color === 3);

  // Partie complète : chacun défend s'il peut, sinon ramasse, et ne relance jamais.
  const started = await call((ack) => A.socket.emit('room:start', ack));
  check('partie lancée', started.ok);
  const sockets = { [lobby.players[0].id]: A, [lobby.players[1].id]: B };
  for (let i = 0; i < 3000; i++) {
    const r = A.room!;
    const g = r.game;
    if (!g || g.phase === 'finished') break;
    const actor = sockets[r.gamePlayerIds[g.actor]];
    const v = actor.room!.game!;
    if (v.actor !== v.you) {
      await new Promise((res) => setTimeout(res, 10));
      continue;
    }
    const L = v.legal;
    const action: Action = L.chooseTargets.length
      ? { type: 'chooseAttacker', target: L.chooseTargets[0] }
      : L.defend.length
        ? { type: 'defend', card: L.defend[0] }
        : L.canTake
          ? { type: 'take' }
          : L.canPass
            ? { type: 'pass' }
            : { type: 'attack', card: L.attack[0] };
    await call((ack) => actor.socket.emit('game:action', action, ack));
  }
  const end = await A.until((r) => r.game?.phase === 'finished' && !!r.myDelta, 30000);
  check('partie terminée', end.game?.phase === 'finished');
  check('évolution des stats en fin de partie', end.myDelta?.before.games === 0 && end.myDelta?.after.games === 1);

  // Ce qui est en base.
  const { data: games } = await admin.from('games').select('id, player_count, trump_suit').eq('room_code', roomCode);
  check('partie enregistrée', games?.length === 1 && games[0].player_count === 2);
  const { data: gp } = await admin.from('game_players').select('profile_id, is_korol, is_durak').eq('game_id', games![0].id);
  check('deux joueurs liés à leurs comptes', gp?.length === 2 && gp.every((p) => users.includes(p.profile_id)));
  check('un Korol et un durak', gp?.filter((p) => p.is_korol).length === 1 && gp?.filter((p) => p.is_durak).length === 1);
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: stats } = await anon.from('player_stats').select('games').in('id', users);
  check('statistiques publiques à jour', stats?.length === 2 && stats.every((s) => s.games === 1));
  const { data: hist } = await anon.rpc('player_history', { p_id: a.id });
  check('historique du profil', hist?.length === 1 && hist[0].others?.[0] === nameB);
  const { error: writeErr } = await anon.from('games').delete().eq('room_code', roomCode);
  const { data: still } = await admin.from('games').select('id').eq('room_code', roomCode);
  check('le navigateur ne peut pas effacer une partie', still?.length === 1, writeErr?.message);

  A.socket.close();
  B.socket.close();
} catch (e) {
  check('déroulé du test', false, String(e));
} finally {
  // Nettoyage : parties de test puis comptes de test (les profils suivent).
  if (roomCode) await admin.from('games').delete().eq('room_code', roomCode);
  for (const id of users) await admin.auth.admin.deleteUser(id);
  const { data: left } = await admin.from('profiles').select('id').in('id', users.length ? users : ['00000000-0000-0000-0000-000000000000']);
  check('nettoyage (comptes et partie supprimés)', (left ?? []).length === 0);
}

for (const [label, ok, detail] of results) console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
