import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import type { Ack, ClientToServer, ServerToClient, Session } from '@durak/engine';
import { type Member, type Room, RoomError, Rooms } from './rooms';

const PORT = Number(process.env.PORT ?? 3000);
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

type Client = Socket<ClientToServer, ServerToClient, object, { code?: string; memberId?: string }>;
const io = new Server<ClientToServer, ServerToClient, object, { code?: string; memberId?: string }>(http, {
  cors: process.env.NODE_ENV === 'production' ? undefined : { origin: true },
});

/** Sockets connectées par joueur (un joueur peut avoir plusieurs onglets). */
const socketsOf = new Map<string, Set<Client>>();

const rooms = new Rooms((room) => broadcast(room));

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

/** Exécute un handler et répond par un accusé de réception uniforme. */
function guard<T extends object>(ack: ((r: Ack<T>) => void) | undefined, fn: () => T) {
  const reply = typeof ack === 'function' ? ack : () => {};
  try {
    reply({ ok: true, ...fn() });
  } catch (e) {
    const error = e instanceof RoomError ? e.message : 'Erreur inattendue du serveur.';
    if (!(e instanceof RoomError)) console.error(e);
    reply({ ok: false, error });
  }
}

io.on('connection', (socket: Client) => {
  socket.on('room:create', (p, ack) =>
    guard(ack, () => {
      const { room, member } = rooms.create(p?.name);
      return attach(socket, room, member);
    }),
  );

  socket.on('room:join', (p, ack) =>
    guard(ack, () => {
      const { room, member } = rooms.join(String(p?.code ?? ''), p?.name);
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

  socket.on('disconnect', () => {
    const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
    const id = socket.data.memberId;
    if (detach(socket) && room && id) rooms.disconnect(room, id);
  });
});

setInterval(() => rooms.sweep(), 60_000).unref();

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
  console.log(`Durak : serveur prêt sur http://localhost:${PORT}`);
});
