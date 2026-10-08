/**
 * Outil de développement : fait rejoindre un salon par de faux joueurs qui jouent
 * des coups légaux au hasard. Ce ne sont pas les bots de la V2.
 *
 *   npx tsx packages/server/scripts/fake-players.ts ABC-123 2
 */
import type { Action, ClientToServer, RoomView, ServerToClient } from '@durak/engine';
import { io, type Socket } from 'socket.io-client';

const [code, countArg = '1', delayArg = '900'] = process.argv.slice(2);
if (!code) {
  console.error('Usage : fake-players.ts <CODE> [nombre] [délai ms]');
  process.exit(1);
}
const url = process.env.DURAK_URL ?? 'http://localhost:3000';
const NAMES = ['Léa', 'Marc', 'Ivan', 'Olga', 'Sacha'];

for (let i = 0; i < Number(countArg); i++) {
  const name = NAMES[i % NAMES.length];
  const socket: Socket<ServerToClient, ClientToServer> = io(url, { transports: ['websocket'] });
  let pending: ReturnType<typeof setTimeout> | null = null;

  socket.on('connect', () => {
    socket.emit('room:join', { code, name }, (r) => console.log(name, r.ok ? 'a rejoint' : r.error));
  });

  socket.on('room:state', (room: RoomView) => {
    const v = room.game;
    if (pending) clearTimeout(pending);
    // Fin de partie : regarde les résultats quelques secondes puis revient au salon.
    if (v?.phase === 'finished') {
      pending = setTimeout(() => socket.emit('room:toLobby', () => {}), 4000 + Math.random() * 4000);
      return;
    }
    if (!v || v.actor !== v.you) return;
    pending = setTimeout(() => {
      const moves: Action[] = [
        ...v.legal.chooseTargets.map((target) => ({ type: 'chooseAttacker', target }) as Action),
        ...v.legal.attack.map((card) => ({ type: 'attack', card }) as Action),
        ...v.legal.defend.map((card) => ({ type: 'defend', card }) as Action),
      ];
      if (v.legal.canPass && Math.random() < 0.5) moves.length = 0;
      if (v.legal.canPass) moves.push({ type: 'pass' });
      if (v.legal.canTake && (moves.length === 0 || Math.random() < 0.15)) moves.splice(0, moves.length, { type: 'take' });
      const move = moves[Math.floor(Math.random() * moves.length)];
      if (move) socket.emit('game:action', move, (r) => !r.ok && console.log(name, r.error));
    }, Number(delayArg));
  });
}
