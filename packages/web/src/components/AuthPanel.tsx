import { NAME_MAX_LENGTH } from '@durak/engine';
import { type FormEvent, useState } from 'react';
import { AVATAR_COLORS, COLOR_NAMES } from '../format';
import { useStore } from '../store';
import { Modal } from './Modal';

/** Connexion : Discord, Google, ou e-mail + mot de passe (connexion, inscription, oubli). */
export function AuthPanel({ compact = false }: { compact?: boolean }) {
  const { signInWith, signInEmail, signUpEmail, sendPasswordReset } = useStore();
  const [showEmail, setShowEmail] = useState(!compact);
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    if (mode === 'login') await signInEmail(email, password);
    else if (mode === 'signup') {
      const r = await signUpEmail(email, password);
      if (r === 'confirm') setNotice('Compte créé : clique sur le lien reçu par e-mail pour l’activer.');
    } else if (await sendPasswordReset(email)) {
      setNotice('Si un compte existe avec cette adresse, un lien pour changer de mot de passe vient d’être envoyé.');
    }
    setBusy(false);
  };

  return (
    <div className="auth-panel">
      <button type="button" className="oauth discord" onClick={() => signInWith('discord')}>
        <DiscordIcon /> Continuer avec Discord
      </button>
      <button type="button" className="oauth google" onClick={() => signInWith('google')}>
        <GoogleIcon /> Continuer avec Google
      </button>
      {!showEmail ? (
        <button type="button" className="linkish" onClick={() => setShowEmail(true)}>
          Utiliser un e-mail et un mot de passe
        </button>
      ) : (
        <form className="auth-email" onSubmit={submit}>
          <div className="tabs" role="tablist" aria-label="Connexion ou inscription">
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
              Se connecter
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>
              Créer un compte
            </button>
          </div>
          <label className="field" htmlFor="auth-email">
            E-mail
            <input
              id="auth-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {mode !== 'forgot' && (
            <label className="field" htmlFor="auth-password">
              Mot de passe {mode === 'signup' && <span className="hint">(8 caractères minimum)</span>}
              <input
                id="auth-password"
                className="input"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={mode === 'signup' ? 8 : undefined}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            {mode === 'login' ? 'Se connecter' : mode === 'signup' ? 'Créer mon compte' : 'Recevoir le lien'}
          </button>
          {mode === 'login' && (
            <button type="button" className="linkish" onClick={() => setMode('forgot')}>
              Mot de passe oublié ?
            </button>
          )}
          {mode === 'forgot' && (
            <button type="button" className="linkish" onClick={() => setMode('login')}>
              Retour à la connexion
            </button>
          )}
          {notice && <p className="auth-notice">{notice}</p>}
        </form>
      )}
    </div>
  );
}

/** Choix du pseudo (et de la couleur) à la première connexion. */
export function ProfileSetup() {
  const { auth, saveProfile, signOut } = useStore();
  const [username, setUsername] = useState(() =>
    (auth.suggestedName ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, NAME_MAX_LENGTH),
  );
  const [color, setColor] = useState(0);
  const [busy, setBusy] = useState(false);
  const ok = username.trim().length >= 2;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    await saveProfile(username.trim(), color);
    setBusy(false);
  };

  return (
    <Modal label="Choisis ton pseudo">
      <form className="setup" onSubmit={submit}>
        <h2>Bienvenue !</h2>
        <p>Choisis le pseudo sous lequel tu joueras et apparaîtras au classement. Il doit être unique.</p>
        <label className="field" htmlFor="setup-name">
          Pseudo
          <input
            id="setup-name"
            className="input"
            value={username}
            maxLength={NAME_MAX_LENGTH}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <div className="colors" role="radiogroup" aria-label="Ta couleur préférée">
          <span className="hint">Couleur :</span>
          {AVATAR_COLORS.map(([bg], c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={COLOR_NAMES[c]}
              title={COLOR_NAMES[c]}
              className={`swatch ${c === color ? 'on' : ''}`}
              style={{ background: bg }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div className="buttons">
          <button type="button" className="btn ghost" onClick={() => signOut()}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={!ok || busy}>
            C’est parti
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Nouveau mot de passe, après le lien « mot de passe oublié ». */
export function PasswordRecovery() {
  const { updatePassword, closeRecovery } = useStore();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await updatePassword(password)) closeRecovery();
    setBusy(false);
  };
  return (
    <Modal label="Nouveau mot de passe" onClose={closeRecovery}>
      <form className="setup" onSubmit={submit}>
        <h2>Nouveau mot de passe</h2>
        <label className="field" htmlFor="recovery-password">
          Mot de passe (8 caractères minimum)
          <input
            id="recovery-password"
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="buttons">
          <button type="submit" className="btn primary" disabled={busy || password.length < 8}>
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Fenêtre de connexion ouverte depuis le salon ou la fin de partie. */
export function AuthModal() {
  const { openAuth, auth } = useStore();
  if (auth.signedIn) return null;
  return (
    <Modal label="Se connecter" onClose={() => openAuth(false)}>
      <h2>Garde tes stats</h2>
      <p>Connecte-toi pour enregistrer tes prochaines parties et apparaître au classement.</p>
      <AuthPanel />
      <div className="buttons">
        <button type="button" className="btn ghost" onClick={() => openAuth(false)}>
          Plus tard
        </button>
      </div>
    </Modal>
  );
}

function DiscordIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
