import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import {
  type Ack,
  type AuthState,
  type ClientToServer,
  PLAYER_COLORS,
  type Profile,
  type PublicConfig,
  type ServerToClient,
  type Session,
} from '@durak/engine';
import { type AccountStore, type Identity, UsernameTakenError } from './accounts';
import { type AccountIdentity, type Member, type Room, RoomError, Rooms, cleanName } from './rooms';
import { SupabaseAccountStore } from './supabaseStore';

const PORT = Number(process.env.PORT ?? 3000);
/** Dossier où les salons sont sauvegardés à l'arrêt du serveur (volume Docker en production). */
const DATA_DIR = process.env.DATA_DIR ?? resolve(fileURLToPath(import.meta.url), '../../.data');
const SNAPSHOT = join(DATA_DIR, 'rooms.json');

// Comptes : activés seulement si le projet Supabase est configuré.
const SUPABASE_URL = process.env.SUPABASE_URL || null;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || null;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const store: AccountStore | null =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? new SupabaseAccountStore(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;
const publicConfig: PublicConfig = {
  supabaseUrl: store ? SUPABASE_URL : null,
  supabaseAnonKey: store ? SUPABASE_ANON_KEY : null,
};
const WEB_DIST = resolve(fileURLToPath(import.meta.url), '../../../web/dist');

// ---------------------------------------------------------------------------
// Fichiers statiques (front buildé) en production
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (url.pathname === '/config.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }).end(JSON.stringify(publicConfig));
    return;
  }
  if (!existsSync(WEB_DIST)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Front non buildé : lance `npm run build`.');
    return;
  }
  let file = normalize(join(WEB_DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(WEB_DIST + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIST, 'index.html');
  const immutable = file.includes(`${WEB_DIST}/assets/`);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(readFileSync(file));
});

// ---------------------------------------------------------------------------
// Temps réel
// ---------------------------------------------------------------------------

interface SocketData {
  code?: string;
  memberId?: string;
  /** Joueur connecté à un compte (jeton vérifié). */
  identity?: Identity | null;
  profile?: Profile | null;
}
type Client = Socket<ClientToServer, ServerToClient, object, SocketData>;
const io = new Server<ClientToServer, ServerToClient, object, SocketData>(http, {
  cors: process.env.NODE_ENV === 'production' ? undefined : { origin: true },
});

/** Sockets connectées par joueur (un joueur peut avoir plusieurs onglets). */
const socketsOf = new Map<string, Set<Client>>();

const rooms = new Rooms((room) => broadcast(room), store);

function broadcast(room: Room) {
  for (const m of room.members) {
    for (const s of socketsOf.get(m.id) ?? []) s.emit('room:state', rooms.viewFor(room, m.id));
  }
}

function attach(socket: Client, room: Room, member: Member): Session {
  detach(socket);
  socket.data.code = room.code;
  socket.data.memberId = member.id;
  if (!socketsOf.has(member.id)) socketsOf.set(member.id, new Set());
  socketsOf.get(member.id)!.add(socket);
  socket.emit('room:state', rooms.viewFor(room, member.id));
  return { code: room.code, playerId: member.id, token: member.token };
}

/** Détache la socket de son salon ; renvoie vrai si c'était la dernière du joueur. */
function detach(socket: Client): boolean {
  const id = socket.data.memberId;
  socket.data.code = undefined;
  socket.data.memberId = undefined;
  if (!id) return false;
  const set = socketsOf.get(id);
  set?.delete(socket);
  if (set && set.size === 0) {
    socketsOf.delete(id);
    return true;
  }
  return false;
}

function current(socket: Client): { room: Room; memberId: string } {
  const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
  if (!room || !socket.data.memberId) throw new RoomError('Tu n’es dans aucun salon.');
  return { room, memberId: socket.data.memberId };
}

/** Exécute un handler (synchrone ou non) et répond par un accusé de réception uniforme. */
async function guard<T extends object>(ack: ((r: Ack<T>) => void) | undefined, fn: () => T | Promise<T>) {
  const reply = typeof ack === 'function' ? ack : () => {};
  try {
    reply({ ok: true, ...(await fn()) });
  } catch (e) {
    const error = e instanceof RoomError ? e.message : 'Erreur inattendue du serveur.';
    if (!(e instanceof RoomError)) console.error(e);
    reply({ ok: false, error });
  }
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

/** Vérifie le jeton Supabase et charge le profil ; un jeton absent ou invalide = invité. */
async function authenticate(socket: Client, token: unknown): Promise<AuthState> {
  socket.data.identity = null;
  socket.data.profile = null;
  if (store && typeof token === 'string' && token) {
    const identity = await store.verifyToken(token).catch(() => null);
    if (identity) {
      socket.data.identity = identity;
      socket.data.profile = await store.getProfile(identity.userId).catch(() => null);
    }
  }
  return authState(socket);
}

const authState = (socket: Client): AuthState => ({
  signedIn: !!socket.data.identity,
  profile: socket.data.profile ?? null,
  suggestedName: socket.data.identity?.suggestedName ?? null,
});

/** Identité de compte à utiliser pour créer ou rejoindre un salon ; vérifie les pseudos des invités. */
async function accountFor(socket: Client, guestName: unknown): Promise<AccountIdentity | undefined> {
  if (socket.data.identity) {
    if (!socket.data.profile) throw new RoomError('Choisis d’abord ton pseudo.');
    return { profile: socket.data.profile };
  }
  if (store) {
    const name = cleanName(guestName);
    const taken = await store.isUsernameTaken(name).catch(() => false);
    if (taken) throw new RoomError('Ce pseudo appartient à un compte : connecte-toi ou choisis-en un autre.');
  }
  return undefined;
}

io.use(async (socket, next) => {
  await authenticate(socket as Client, socket.handshake.auth?.token);
  next();
});

io.on('connection', (socket: Client) => {
  socket.on('auth:set', (p, ack) => guard(ack, () => authenticate(socket, p?.token)));

  socket.on('profile:save', (p, ack) =>
    guard(ack, async () => {
      const identity = socket.data.identity;
      if (!store || !identity) throw new RoomError('Connecte-toi pour enregistrer un profil.');
      const username = cleanName(p?.username);
      if (username.length < 2) throw new RoomError('Ton pseudo doit faire au moins 2 caractères.');
      const color = Number(p?.color);
      if (!Number.isInteger(color) || color < 0 || color >= PLAYER_COLORS) throw new RoomError('Couleur invalide.');
      try {
        socket.data.profile = await store.saveProfile(identity.userId, {
          username,
          color,
          avatarUrl: socket.data.profile?.avatarUrl ?? identity.avatarUrl,
        });
      } catch (e) {
        if (e instanceof UsernameTakenError) throw new RoomError('Ce pseudo est déjà pris. Choisis-en un autre.');
        throw e;
      }
      return authState(socket);
    }),
  );

  socket.on('room:create', (p, ack) =>
    guard(ack, async () => {
      const account = await accountFor(socket, p?.name);
      const { room, member } = rooms.create(p?.name, account);
      return attach(socket, room, member);
    }),
  );

  socket.on('room:join', (p, ack) =>
    guard(ack, async () => {
      const account = await accountFor(socket, p?.name);
      const { room, member } = rooms.join(String(p?.code ?? ''), p?.name, account);
      return attach(socket, room, member);
    }),
  );

  socket.on('room:resume', (p, ack) =>
    guard(ack, () => {
      const { room, member } = rooms.resume(String(p?.code ?? ''), String(p?.token ?? ''));
      return attach(socket, room, member);
    }),
  );

  socket.on('room:leave', () => {
    const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
    const id = socket.data.memberId;
    // Tous les onglets de ce joueur quittent le salon.
    for (const s of socketsOf.get(id ?? '') ?? []) {
      s.data.code = undefined;
      s.data.memberId = undefined;
      if (s !== socket) s.emit('room:closed', 'Tu as quitté le salon.');
    }
    if (id) socketsOf.delete(id);
    if (room && id) rooms.leave(room, id);
  });

  socket.on('room:settings', (p, ack) =>
    guard(ack, () => {
      const { room, memberId } = current(socket);
      rooms.updateSettings(room, memberId, { turnSeconds: Number(p?.turnSeconds) });
      return {};
    }),
  );

  socket.on('room:reorder', (p, ack) =>
    guard(ack, () => {
      const { room, memberId } = current(socket);
      rooms.reorder(room, memberId, Array.isArray(p?.order) ? p.order.map(String) : []);
      return {};
    }),
  );

  socket.on('room:kick', (p, ack) =>
    guard(ack, () => {
      const { room, memberId } = current(socket);
      const kicked = rooms.kick(room, memberId, String(p?.playerId ?? ''));
      for (const s of socketsOf.get(kicked.id) ?? []) {
        s.data.code = undefined;
        s.data.memberId = undefined;
        s.emit('room:closed', 'L’hôte t’a retiré du salon.');
      }
      socketsOf.delete(kicked.id);
      return {};
    }),
  );

  socket.on('room:color', (p, ack) =>
    guard(ack, () => {
      const { room, memberId } = current(socket);
      rooms.setColor(room, memberId, Number(p?.color));
      return {};
    }),
  );

  socket.on('room:start', (ack) =>
    guard(ack, () => {
      const { room, memberId } = current(socket);
      rooms.start(room, memberId);
      return {};
    }),
  );

  socket.on('room:toLobby', (ack) =>
    guard(ack, () => {
      const { room, memberId } = current(socket);
      rooms.toLobby(room, memberId);
      return {};
    }),
  );

  socket.on('game:action', (action, ack) =>
    guard(ack, () => {
      const { room, memberId } = current(socket);
      rooms.act(room, memberId, action);
      return {};
    }),
  );

  socket.on('chat:send', (p, ack) =>
    guard(ack, () => {
      const { room, memberId } = current(socket);
      rooms.chat(room, memberId, p?.text);
      return {};
    }),
  );

  socket.on('disconnect', () => {
    const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
    const id = socket.data.memberId;
    if (detach(socket) && room && id) rooms.disconnect(room, id);
  });
});

setInterval(() => rooms.sweep(), 60_000).unref();

// ---------------------------------------------------------------------------
// Sauvegarde des salons : écrite à l'arrêt (déploiement), relue au démarrage
// ---------------------------------------------------------------------------

if (existsSync(SNAPSHOT)) {
  try {
    const count = rooms.restore(readFileSync(SNAPSHOT, 'utf8'));
    console.log(`Durak : ${count} salon(s) repris après redémarrage.`);
  } catch (e) {
    console.error('Sauvegarde des salons illisible, ignorée :', e);
  }
  rmSync(SNAPSHOT, { force: true });
}

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SNAPSHOT, rooms.snapshot());
    console.log(`Durak : ${signal} reçu, salons sauvegardés.`);
  } catch (e) {
    console.error('Impossible de sauvegarder les salons :', e);
  }
  io.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Le port ${PORT} est déjà utilisé : un autre serveur Durak tourne sans doute déjà.\n` +
        `Arrête-le (Ctrl+C dans son terminal) ou choisis un autre port : DURAK_SERVER_PORT=3001 npm run dev`,
    );
    process.exit(1);
  }
  throw err;
});

http.listen(PORT, () => {
  console.log(`Durak : serveur prêt sur http://localhost:${PORT} (comptes ${store ? 'activés' : 'désactivés'})`);
});
