import { type Card, NAME_MAX_LENGTH } from '@durak/engine';
import { motion } from 'motion/react';
import { type FormEvent, useState } from 'react';
import { useStore } from '../store';
import { PlayingCard } from './PlayingCard';

const FAN: Card[] = [
  { r: 7, s: 'C' },
  { r: 10, s: 'D' },
  { r: 12, s: 'S' },
  { r: 13, s: 'H' },
  { r: 14, s: 'H' },
];

/** Met en forme la saisie du code : K7P2QX -> K7P-2QX. */
const formatCode = (raw: string) => {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return s.length > 3 ? `${s.slice(0, 3)}-${s.slice(3)}` : s;
};

export function Home({ onRules }: { onRules: () => void }) {
  const { name, setName, create, join } = useStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const nameOk = name.trim().length > 0;
  const codeOk = code.replace('-', '').length === 6;

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (nameOk && codeOk) run(() => join(code));
  };

  return (
    <main className="home">
      <div className="home-inner">
        <div>
          <div className="fan" aria-hidden="true">
            {FAN.map((c, i) => (
              <PlayingCard
                key={i}
                card={c}
                trump="H"
                initial={{ rotate: 0, x: '-50%', y: 40, opacity: 0 }}
                animate={{ rotate: (i - 2) * 13, x: '-50%', y: 0, opacity: 1 }}
                transition={{ delay: 0.08 * i, type: 'spring', stiffness: 160, damping: 18 }}
              />
            ))}
          </div>
          <h1>Durak</h1>
          <p className="sub">Ne sois pas le dernier avec des cartes en main.</p>
        </div>

        <motion.form
          className="panel"
          onSubmit={onJoin}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <label className="field" htmlFor="pseudo">
            Ton pseudo
            <input
              id="pseudo"
              className="input"
              value={name}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="nickname"
              placeholder="Ex. Tanguy"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={!nameOk || busy}
            onClick={() => run(create)}
          >
            Créer un salon
          </button>
          <div className="or">ou rejoindre</div>
          <label className="field" htmlFor="code">
            Code du salon
            <input
              id="code"
              className="input mono"
              value={code}
              placeholder="ABC-123"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(formatCode(e.target.value))}
            />
          </label>
          <button type="submit" className="btn ghost" disabled={!nameOk || !codeOk || busy}>
            Rejoindre
          </button>
          {!nameOk && <span className="hint">Choisis d’abord un pseudo.</span>}
          <div>
            <button type="button" className="linkish" onClick={onRules}>
              Règles du jeu
            </button>
          </div>
        </motion.form>
      </div>
    </main>
  );
}
