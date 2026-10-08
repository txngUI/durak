import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Game } from './components/Game';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Rules } from './components/Rules';
import { useStore } from './store';

export function App() {
  const { room, session, connection, toasts, dismiss } = useStore();
  const [rules, setRules] = useState(false);
  // Une fois dans un salon, on retire le code d'invitation de l'adresse.
  useEffect(() => {
    if (room && location.search) history.replaceState(null, '', '/');
  }, [room]);
  const openRules = () => setRules(true);

  let screen;
  if (room?.status === 'playing' && room.game) screen = <Game room={room} onRules={openRules} />;
  else if (room) screen = <Lobby room={room} onRules={openRules} />;
  else if (session && connection !== 'offline') screen = <div className="home hint">Retour à ta table…</div>;
  else screen = <Home onRules={openRules} />;

  return (
    <>
      {connection === 'offline' && <div className="offline">Connexion au serveur perdue. Reconnexion en cours…</div>}
      {screen}
      {rules && <Rules onClose={() => setRules(false)} />}
      <div className="toasts" aria-live="assertive">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast ${t.kind}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              onClick={() => dismiss(t.id)}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
