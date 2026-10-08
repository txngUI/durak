import type { Ack, Action, AuthState, ClientToServer, RoomView, ServerToClient, Session } from '@durak/engine';
import { initSupabase, returnUrl, supabase } from './auth';
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

  // --- Comptes ---------------------------------------------------------------
  /** Le serveur a un projet Supabase configuré. */
  accountsEnabled: boolean;
  auth: AuthState;
  signInWith: (provider: 'discord' | 'google') => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<boolean>;
  /** Renvoie 'confirm' si un e-mail de confirmation a été envoyé. */
  signUpEmail: (email: string, password: string) => Promise<'ok' | 'confirm' | null>;
  sendPasswordReset: (email: string) => Promise<boolean>;
  updatePassword: (password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  saveProfile: (username: string, color: number) => Promise<boolean>;

  // --- Fenêtres ----------------------------------------------------------------
  /** Profil affiché (id de compte), ou null. */
  profileView: string | null;
  leaderboardOpen: boolean;
  authOpen: boolean;
  /** Le joueur est revenu par le lien « mot de passe oublié » : il doit en choisir un nouveau. */
  recoveryOpen: boolean;
  openProfile: (id: string | null) => void;
  openLeaderboard: (open: boolean) => void;
  openAuth: (open: boolean) => void;
  closeRecovery: () => void;
}

const SIGNED_OUT: AuthState = { signedIn: false, profile: null, suggestedName: null };

/** Messages d'erreur Supabase traduits pour les cas courants. */
function authError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'E-mail ou mot de passe incorrect.';
  if (m.includes('email not confirmed')) return 'Confirme d’abord ton adresse : clique sur le lien reçu par e-mail.';
  if (m.includes('already registered')) return 'Un compte existe déjà avec cet e-mail : connecte-toi.';
  if (m.includes('password should be')) return 'Mot de passe trop court : 8 caractères minimum.';
  if (m.includes('rate limit')) return 'Trop de tentatives : réessaie dans quelques minutes.';
  if (m.includes('valid email') || m.includes('invalid email')) return 'Cette adresse e-mail n’est pas valide.';
  return message;
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

/** Jeton Supabase courant, envoyé au serveur de jeu à chaque (re)connexion. */
let accessToken: string | null = null;

const socket: Socket<ServerToClient, ClientToServer> = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: (cb) => cb({ token: accessToken }),
});

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

  /** Transmet le jeton au serveur de jeu et récupère l'état de connexion (profil…). */
  const syncAuth = () => {
    if (!socket.connected) return;
    socket.emit('auth:set', { token: accessToken }, (r) => {
      if (r.ok) set({ auth: { signedIn: r.signedIn, profile: r.profile, suggestedName: r.suggestedName } });
    });
  };

  // Démarrage : configuration publique, session Supabase éventuelle, puis connexion au jeu.
  initSupabase().then(async (client) => {
    if (client) {
      set({ accountsEnabled: true });
      const { data } = await client.auth.getSession();
      accessToken = data.session?.access_token ?? null;
      client.auth.onAuthStateChange((event, session) => {
        accessToken = session?.access_token ?? null;
        if (event === 'PASSWORD_RECOVERY') set({ recoveryOpen: true });
        if (event === 'SIGNED_OUT') set({ auth: SIGNED_OUT });
        if (event !== 'INITIAL_SESSION') syncAuth();
      });
    }
    socket.connect();
  });

  socket.on('connect', () => {
    set({ connection: 'online' });
    syncAuth();
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

    accountsEnabled: false,
    auth: SIGNED_OUT,
    signInWith: async (provider) => {
      const client = supabase();
      if (!client) return;
      const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: returnUrl() } });
      if (error) get().toast(authError(error.message));
    },
    signInEmail: async (email, password) => {
      const client = supabase();
      if (!client) return false;
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) get().toast(authError(error.message));
      return !error;
    },
    signUpEmail: async (email, password) => {
      const client = supabase();
      if (!client) return null;
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: returnUrl() },
      });
      if (error) {
        get().toast(authError(error.message));
        return null;
      }
      return data.session ? 'ok' : 'confirm';
    },
    sendPasswordReset: async (email) => {
      const client = supabase();
      if (!client) return false;
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: returnUrl() });
      if (error) get().toast(authError(error.message));
      return !error;
    },
    updatePassword: async (password) => {
      const client = supabase();
      if (!client) return false;
      const { error } = await client.auth.updateUser({ password });
      if (error) get().toast(authError(error.message));
      else get().toast('Mot de passe mis à jour.', 'info');
      return !error;
    },
    signOut: async () => {
      await supabase()?.auth.signOut();
      accessToken = null;
      set({ auth: SIGNED_OUT });
      syncAuth();
    },
    saveProfile: async (username, color) => {
      const r = await request<AuthState>((ack) => socket.emit('profile:save', { username, color }, ack));
      if (r) set({ auth: { signedIn: r.signedIn, profile: r.profile, suggestedName: r.suggestedName } });
      return !!r;
    },

    profileView: null,
    leaderboardOpen: false,
    authOpen: false,
    recoveryOpen: false,
    openProfile: (id) => set({ profileView: id, leaderboardOpen: false }),
    openLeaderboard: (open) => set({ leaderboardOpen: open, profileView: null }),
    openAuth: (open) => set({ authOpen: open }),
    closeRecovery: () => set({ recoveryOpen: false }),
    kick: async (playerId) => !!(await request((ack) => socket.emit('room:kick', { playerId }, ack))),
    setColor: async (color) => !!(await request((ack) => socket.emit('room:color', { color }, ack))),
    chatSeen: 0,
    markChatSeen: () => set({ chatSeen: get().room?.chat.at(-1)?.id ?? 0 }),
  };
});

// Accès au store depuis la console, en développement uniquement (tests manuels).
if (import.meta.env.DEV) (window as unknown as { __durak: typeof useStore }).__durak = useStore;
