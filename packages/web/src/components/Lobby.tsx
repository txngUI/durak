import { EXTRA_SUITS_FROM_PLAYERS, MAX_PLAYERS, MIN_PLAYERS, type RoomView, TURN_SECONDS_OPTIONS } from '@durak/engine';
import { motion } from 'motion/react';
import { useState } from 'react';
import { inviteLink, useStore } from '../store';
import { AppBar, Avatar } from './Account';
import { Chat } from './Chat';
import { HostBadge } from './HostBadge';
import { SuitGlyph } from './PlayingCard';

export function Lobby({ room, onRules }: { room: RoomView; onRules: () => void }) {
  const { start, leave, setTurnSeconds, reorder, toast, kick, accountsEnabled, openProfile, auth, openAuth } =
    useStore();
  const [confirmKick, setConfirmKick] = useState<string | null>(null);
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
    <div className="app-shell">
      <AppBar onRules={onRules} />
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

        {accountsEnabled &&
          (auth.profile ? null : (
            !auth.signedIn && (
              <div className="hint">
                Tu joues en invité.{' '}
                <button type="button" className="linkish" onClick={() => openAuth(true)}>
                  Connecte-toi
                </button>{' '}
                pour enregistrer tes prochaines parties.
              </div>
            )
          ))}

        <ol className="seats" aria-label="Places à la table">
          {Array.from({ length: MAX_PLAYERS }, (_, i) => {
            const p = room.players[i];
            if (!p)
              return (
                <li key={`empty-${i}`} className="seat empty">
                  Place libre
                </li>
              );
            if (confirmKick === p.id)
              return (
                <li key={p.id} className="seat kick-confirm">
                  <span>
                    Retirer <b>{p.name}</b> ?
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button type="button" className="btn ghost small" onClick={() => setConfirmKick(null)}>
                      Non
                    </button>
                    <button
                      type="button"
                      className="btn danger small"
                      onClick={() => {
                        setConfirmKick(null);
                        kick(p.id);
                      }}
                    >
                      Retirer
                    </button>
                  </span>
                </li>
              );
            const stats = p.stats ? `${p.stats.korol} Korol · ${p.stats.durak} durak` : null;
            const tags = [
              p.id === room.you ? 'toi' : null,
              accountsEnabled ? stats : null,
              p.id === room.lastDurakId ? 'durak de la dernière partie' : null,
              !p.connected ? 'déconnecté' : null,
              p.inResults ? 'regarde encore les résultats…' : null,
            ].filter(Boolean);
            return (
              <motion.li layout key={p.id} className={`seat ${p.inResults ? 'away-seat' : ''}`}>
                <Avatar name={p.name} color={p.color} url={p.avatarUrl} className={p.connected ? '' : 'away'} />
                <div className="who">
                  <b>
                    {p.profileId ? (
                      <button type="button" className="name-link" onClick={() => openProfile(p.profileId)}>
                        {p.name}
                      </button>
                    ) : (
                      p.name
                    )}
                    {p.id === room.hostId && <HostBadge />}
                    {accountsEnabled &&
                      (p.profileId ? <span className="acct-badge">Compte</span> : <span className="guest-badge">Invité</span>)}
                  </b>
                  <small>{tags.join(' · ') || 'Prêt'}</small>
                </div>
                {isHost && count > 1 ? (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    {p.id !== room.you && (
                      <button
                        type="button"
                        className="icon-btn kick"
                        aria-label={`Retirer ${p.name} du salon`}
                        title="Retirer du salon"
                        onClick={() => setConfirmKick(p.id)}
                      >
                        ✕
                      </button>
                    )}
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

        {count >= EXTRA_SUITS_FROM_PLAYERS && (
          <div className="extra-suits-note">
            <span>À {count} joueurs, on joue avec <b>54 cartes</b> : deux couleurs en plus,</span>
            <span>
              <span className="suit">
                <SuitGlyph suit="L" />
              </span>{' '}
              lys (noir)
            </span>
            <span>et</span>
            <span>
              <span className="suit red">
                <SuitGlyph suit="E" />
              </span>{' '}
              étoile (rouge).
            </span>
          </div>
        )}

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
        {!auth.profile && (
          <div>
            <button type="button" className="linkish" onClick={onRules}>
              Règles du jeu
            </button>
          </div>
        )}
        <section className="lobby-chat" aria-label="Chat du salon">
          <Chat room={room} />
        </section>
      </div>
    </main>
    </div>
  );
}
