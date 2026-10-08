import type { Ack, Action, ClientToServer, RoomView, ServerToClient, Session } from '@durak/engine';
import { type Socket, io } from 'socket.io-client';
import { create } from 'zustand';

const SESSION_KEY = 'durak.session';
const NAME_KEY = 'durak.name';

// Session par onglet : on peut ouvrir plusieurs onglets pour plusieurs joueurs,
// et une actualisation de la page reprend la même place.
const storage = {
  get<T>(store: Storage, key: string): T | null {
    try {
      const raw = store.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(store: Storage, key: string, value: unknown) {
    try {
      if (value === null) store.removeItem(key);
      else store.setItem(key, JSON.stringify(value));
    } catch {
      /* stockage indisponible : on continue sans */
    }
  },
};

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

interface State {
  connection: 'connecting' | 'online' | 'offline';
  room: RoomView | null;
  session: Session | null;
  name: string;
  toasts: Toast[];
  /** Décalage horloge serveur − client, mesuré à la réception de chaque état. */
  clockOffset: number;
  setName: (n: string) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
  create: () => Promise<boolean>;
  join: (code: string) => Promise<boolean>;
  leave: () => void;
  start: () => Promise<boolean>;
  toLobby: () => Promise<boolean>;
  setTurnSeconds: (s: number) => Promise<boolean>;
  reorder: (order: string[]) => Promise<boolean>;
  act: (a: Action) => Promise<boolean>;
  sendChat: (text: string) => Promise<boolean>;
  kick: (playerId: string) => Promise<boolean>;
  setColor: (color: number) => Promise<boolean>;
  /** Id du dernier message de chat lu, pour le compteur de non-lus. */
  chatSeen: number;
  markChatSeen: () => void;
}

/** Lien d'invitation : la page d'accueil pré-remplit le code du salon. */
export const inviteLink = (code: string) => `${location.origin}/?code=${code.replace('-', '')}`;
export const codeFromUrl = () => {
  try {
    const c = new URLSearchParams(location.search).get('code') ?? '';
    return c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  } catch {
    return '';
  }
};

const socket: Socket<ServerToClient, ClientToServer> = io({ autoConnect: true, transports: ['websocket', 'polling'] });

let toastId = 0;

export const useStore = create<State>((set, get) => {
  /** Envoie une requête et transforme l'accusé en booléen + message d'erreur. */
  const request = <T extends object>(send: (ack: (r: Ack<T>) => void) => void): Promise<(Ack<T> & { ok: true }) | null> =>
    new Promise((resolve) => {
      if (!socket.connected) {
        get().toast('Pas de connexion au serveur. Nouvelle tentative en cours…');
        resolve(null);
        return;
      }
      send((r) => {
        if (r.ok) resolve(r as Ack<T> & { ok: true });
        else {
          get().toast(r.error);
          resolve(null);
        }
      });
    });

  const remember = (s: Session | null) => {
    storage.set(sessionStorage, SESSION_KEY, s);
    set({ session: s });
  };

  socket.on('connect', () => {
    set({ connection: 'online' });
    const s = get().session;
    if (s) {
      socket.emit('room:resume', { code: s.code, token: s.token }, (r) => {
        if (!r.ok) {
          remember(null);
          set({ room: null });
        }
      });
    }
  });
  socket.on('disconnect', () => set({ connection: 'offline' }));
  socket.on('connect_error', () => set({ connection: 'offline' }));
  socket.on('room:state', (room) => set({ room, clockOffset: room.serverNow - Date.now() }));
  socket.on('room:closed', (reason) => {
    remember(null);
    set({ room: null });
    get().toast(reason, 'info');
  });

  return {
    connection: 'connecting',
    room: null,
    session: storage.get<Session>(sessionStorage, SESSION_KEY),
    name: storage.get<string>(localStorage, NAME_KEY) ?? '',
    toasts: [],
    clockOffset: 0,

    setName: (name) => {
      storage.set(localStorage, NAME_KEY, name);
      set({ name });
    },
    toast: (text, kind = 'error') => {
      const id = ++toastId;
      set({ toasts: [...get().toasts.slice(-2), { id, text, kind }] });
      setTimeout(() => get().dismiss(id), 4000);
    },
    dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

    create: async () => {
      const r = await request<Session>((ack) => socket.emit('room:create', { name: get().name }, ack));
      if (r) remember({ code: r.code, playerId: r.playerId, token: r.token });
      return !!r;
    },
    join: async (code) => {
      const r = await request<Session>((ack) => socket.emit('room:join', { code, name: get().name }, ack));
      if (r) remember({ code: r.code, playerId: r.playerId, token: r.token });
      return !!r;
    },
    leave: () => {
      socket.emit('room:leave');
      remember(null);
      set({ room: null });
    },
    start: async () => !!(await request((ack) => socket.emit('room:start', ack))),
    toLobby: async () => !!(await request((ack) => socket.emit('room:toLobby', ack))),
    setTurnSeconds: async (turnSeconds) => !!(await request((ack) => socket.emit('room:settings', { turnSeconds }, ack))),
    reorder: async (order) => !!(await request((ack) => socket.emit('room:reorder', { order }, ack))),
    act: async (a) => !!(await request((ack) => socket.emit('game:action', a, ack))),
    sendChat: async (text) => !!(await request((ack) => socket.emit('chat:send', { text }, ack))),
    kick: async (playerId) => !!(await request((ack) => socket.emit('room:kick', { playerId }, ack))),
    setColor: async (color) => !!(await request((ack) => socket.emit('room:color', { color }, ack))),
    chatSeen: 0,
    markChatSeen: () => set({ chatSeen: get().room?.chat.at(-1)?.id ?? 0 }),
  };
});

// Accès au store depuis la console, en développement uniquement (tests manuels).
if (import.meta.env.DEV) (window as unknown as { __durak: typeof useStore }).__durak = useStore;
