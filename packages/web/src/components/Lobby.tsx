import { MAX_PLAYERS, MIN_PLAYERS, type RoomView, TURN_SECONDS_OPTIONS } from '@durak/engine';
import { motion } from 'motion/react';
import { useState } from 'react';
import { avatarColors, initial } from '../format';
import { inviteLink, useStore } from '../store';
import { Chat } from './Chat';

export function Lobby({ room, onRules }: { room: RoomView; onRules: () => void }) {
  const { start, leave, setTurnSeconds, reorder, toast } = useStore();
  const isHost = room.you === room.hostId;
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const count = room.players.length;
  const waiting = room.players.filter((p) => p.inResults).map((p) => p.name);

  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? room.code : inviteLink(room.code));
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast('Copie impossible : note le code affiché.', 'info');
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const ids = room.players.map((p) => p.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids);
  };

  return (
    <main className="lobby">
      <div className="lobby-inner">
        <div className="top">
          <h1 className="logo" style={{ fontSize: 28, margin: 0 }}>
            Salon
          </h1>
          <div className="code-block">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="code" aria-label={`Code du salon ${room.code.split('').join(' ')}`}>
                {room.code}
              </span>
              <button type="button" className="btn ghost small" onClick={() => copy('code')}>
                {copied === 'code' ? 'Code copié' : 'Copier le code'}
              </button>
              <button type="button" className="btn ghost small" onClick={() => copy('link')}>
                {copied === 'link' ? 'Lien copié' : 'Copier le lien'}
              </button>
            </div>
            <div className="hint">Donne ce code ou le lien à tes amis pour qu’ils rejoignent la table.</div>
          </div>
        </div>

        <ol className="seats" aria-label="Places à la table">
          {Array.from({ length: MAX_PLAYERS }, (_, i) => {
            const p = room.players[i];
            if (!p)
              return (
                <li key={`empty-${i}`} className="seat empty">
                  Place libre
                </li>
              );
            const [bg, fg] = avatarColors(i);
            const tags = [
              p.id === room.hostId ? 'Hôte' : null,
              p.id === room.you ? 'toi' : null,
              p.id === room.lastDurakId ? 'durak de la dernière partie' : null,
              !p.connected ? 'déconnecté' : null,
              p.inResults ? 'regarde encore les résultats…' : null,
            ].filter(Boolean);
            return (
              <motion.li layout key={p.id} className={`seat ${p.inResults ? 'away-seat' : ''}`}>
                <span className={`av ${p.connected ? '' : 'away'}`} style={{ background: bg, color: fg }}>
                  {initial(p.name)}
                </span>
                <div className="who">
                  <b>{p.name}</b>
                  <small>{tags.join(' · ') || 'Prêt'}</small>
                </div>
                {isHost && count > 1 ? (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Avancer ${p.name} d’une place`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Reculer ${p.name} d’une place`}
                      disabled={i === count - 1}
                      onClick={() => move(i, 1)}
                    >
                      →
                    </button>
                  </span>
                ) : (
                  <span className="num">{i + 1}</span>
                )}
              </motion.li>
            );
          })}
        </ol>

        <div className="foot">
          <div className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="turn">Temps par action :</label>
            {isHost ? (
              <select
                id="turn"
                value={room.settings.turnSeconds}
                onChange={(e) => setTurnSeconds(Number(e.target.value))}
              >
                {TURN_SECONDS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s ? `${s} s` : 'illimité'}
                  </option>
                ))}
              </select>
            ) : (
              <b id="turn">{room.settings.turnSeconds ? `${room.settings.turnSeconds} s` : 'illimité'}</b>
            )}
            <span>· L’ordre des places est l’ordre de la table.</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn ghost" onClick={leave}>
              Quitter
            </button>
            {isHost ? (
              <button
                type="button"
                className="btn primary"
                disabled={count < MIN_PLAYERS || waiting.length > 0}
                onClick={() => start()}
              >
                {waiting.length > 0
                  ? `En attente de ${waiting.join(', ')}…`
                  : count < MIN_PLAYERS
                    ? 'En attente d’un 2e joueur'
                    : `Lancer la partie (${count} joueurs)`}
              </button>
            ) : (
              <span className="hint" style={{ alignSelf: 'center' }}>
                L’hôte lancera la partie.
              </span>
            )}
          </div>
        </div>
        <section className="lobby-chat" aria-label="Chat du salon">
          <Chat room={room} />
        </section>
        <div>
          <button type="button" className="linkish" onClick={onRules}>
            Règles du jeu
          </button>
        </div>
      </div>
    </main>
  );
}
