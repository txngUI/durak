import { type Card, type LastRound, type PlayerView, type RoomView, SUIT_SYMBOL, cardLabel } from '@durak/engine';
import { AnimatePresence, type PanInfo, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { avatarColors, cardKey, initial, logText, promptFor, sameCard } from '../format';
import { useStore } from '../store';
import { Modal } from './Modal';
import { PlayingCard } from './PlayingCard';

type Exit = 'take' | 'discard';

/** Durée d'affichage des cartes d'un pli terminé avant qu'elles partent. */
const LINGER_MS = 2400;

const pairVariants = {
  exit: (kind: Exit) =>
    kind === 'take'
      ? { opacity: 0, y: -160, scale: 0.6, transition: { duration: 0.45 } }
      : { opacity: 0, x: 280, rotate: 18, transition: { duration: 0.45 } },
};

function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

const clamp = (min: number, v: number, max: number) => Math.max(min, Math.min(max, v));

export function Game({ room, onRules }: { room: RoomView; onRules: () => void }) {
  const v = room.game!;
  const { act, leave, start, toLobby } = useStore();
  const clockOffset = useStore((s) => s.clockOffset);
  const name = (p: number) => v.players[p]?.name ?? '?';
  const connected = (p: number) => room.players.find((x) => x.id === room.gamePlayerIds[p])?.connected ?? false;
  const isHost = room.you === room.hostId;
  const n = v.players.length;
  const me = v.players[v.you];

  // --- Sélection et coups légaux --------------------------------------------
  const legal: Card[] = v.phase === 'defend' ? v.legal.defend : v.phase === 'attack' ? v.legal.attack : [];
  const yourTurn = v.actor === v.you && (v.phase === 'attack' || v.phase === 'defend');
  const [selected, setSelected] = useState<Card | null>(null);
  const turnKey = `${v.round}-${v.phase}-${v.actor}-${v.table.length}`;
  useEffect(() => setSelected(null), [turnKey]);
  const isLegal = (c: Card) => legal.some((l) => sameCard(l, c));

  const play = (card: Card) => {
    if (!isLegal(card)) return;
    setSelected(null);
    act(v.phase === 'defend' ? { type: 'defend', card } : { type: 'attack', card });
  };

  // --- Glisser-déposer sur le tapis -----------------------------------------
  const tableRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const onDragEnd = (card: Card, info: PanInfo) => {
    setDragging(false);
    const r = tableRef.current?.getBoundingClientRect();
    if (!r) return;
    const { x, y } = info.point;
    const sx = x - window.scrollX;
    const sy = y - window.scrollY;
    if (sx >= r.left && sx <= r.right && sy >= r.top - 40 && sy <= r.bottom + 40) play(card);
  };

  // --- Événements marquants (bandeau) et sens de sortie des cartes ----------
  const prevLog = useRef(v.logSize);
  const [flash, setFlash] = useState<string | null>(null);
  const [exitKind, setExitKind] = useState<Exit>('discard');
  useLayoutEffect(() => {
    const fresh = v.log.slice(-Math.min(v.logSize - prevLog.current, v.log.length));
    prevLog.current = v.logSize;
    if (fresh.length === 0) return;
    let message: string | null = null;
    for (const e of fresh) {
      if (e.t === 'take') {
        setExitKind('take');
      } else if (e.t === 'discard') {
        setExitKind('discard');
      } else if (e.t === 'out' && v.phase !== 'finished') {
        message = e.p === v.you ? 'Tu es sorti !' : `${name(e.p)} est sorti !`;
      }
    }
    if (message) setFlash(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.logSize]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // --- Pli terminé : on laisse ses cartes visibles un instant ---------------
  const [linger, setLinger] = useState<LastRound | null>(null);
  const seenRound = useRef(v.lastRound?.round ?? 0);
  useEffect(() => {
    if (!v.lastRound || v.lastRound.round === seenRound.current) return;
    seenRound.current = v.lastRound.round;
    setLinger(v.lastRound);
    const t = setTimeout(() => setLinger(null), LINGER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.lastRound?.round]);
  // Dès qu'une nouvelle carte est posée, le pli suivant prend la place.
  const shownLinger = linger && v.table.length === 0 && v.phase !== 'finished' ? linger : null;
  const shownTable = shownLinger ? shownLinger.table : v.table;
  const tableDefender = shownLinger ? shownLinger.defender : v.defender;

  // --- Mise en page de la main ----------------------------------------------
  // Tailles de cartes calculées selon la largeur ET la hauteur de l'écran.
  const { w: vw, h: vh } = useViewport();
  const mobile = vw <= 760;
  const short = vh < 640;
  const cw = Math.round(clamp(44, vh * 0.16, mobile ? 58 : 84));
  const sizes = {
    '--hand-cw': `${cw}px`,
    '--table-cw': `${Math.round(clamp(40, vh * 0.12, mobile ? 54 : 74))}px`,
    '--deck-cw': `${Math.round(clamp(40, vh * 0.11, 66))}px`,
  } as React.CSSProperties;
  const avail = mobile ? vw - 24 : Math.min(vw - 420, 900);
  const count = v.hand.length;
  const overlap = count > 1 ? Math.max(-cw * 0.72, Math.min(mobile ? -10 : -14, (avail - count * cw) / (count - 1))) : 0;

  // --- Adversaires, dans l'ordre de la table à partir de ta gauche ----------
  const opponents = Array.from({ length: n - 1 }, (_, i) => (v.you + 1 + i) % n);
  const roleOf = (p: number) => {
    if (v.players[p].place !== null) return { cls: 'out', text: 'sorti' };
    if (v.phase === 'finished') return null;
    if (p === v.defender) return { cls: 'def', text: v.phase === 'chooseAttacker' ? 'choisit' : 'défend' };
    if (p === v.attacker) return { cls: 'att', text: 'attaque' };
    if (p === v.actor) return { cls: 'att', text: 'relance' };
    return null;
  };

  const prompt = promptFor(v, name);
  const last = v.table[v.table.length - 1];
  const [confirmLeave, setConfirmLeave] = useState(false);

  return (
    <div className={`game ${short ? 'short' : ''}`} style={sizes}>
      {/* Barre du haut */}
      <header className="topbar">
        <span className="logo" style={{ fontSize: 22 }}>
          Durak
        </span>
        <div className="right">
          <span className="pill">
            Atout {SUIT_SYMBOL[v.trumpSuit]}
          </span>
          <span className="pill">Pli {v.round}</span>
          <span className="pill room-code">{room.code}</span>
          <button type="button" className="icon-btn" onClick={onRules}>
            Règles
          </button>
          <button type="button" className="icon-btn" onClick={() => setConfirmLeave(true)}>
            Quitter
          </button>
        </div>
      </header>

      {/* Adversaires */}
      <section className="opps" aria-label="Adversaires">
        {opponents.map((p, i) => {
          const m = opponents.length;
          const norm = m > 1 ? Math.abs(i - (m - 1) / 2) / ((m - 1) / 2) : 0;
          const [bg, fg] = avatarColors(p);
          const role = roleOf(p);
          const pl = v.players[p];
          return (
            <div
              key={p}
              className={`opp ${pl.place !== null ? 'out' : ''}`}
              style={{ transform: mobile || short ? undefined : `translateY(${norm * norm * 34}px)` }}
            >
              <div className="backs" aria-hidden="true">
                {Array.from({ length: Math.min(pl.cardCount, 12) }, (_, k) => (
                  <PlayingCard key={k} />
                ))}
              </div>
              <div className="name">
                <span
                  className={`av ${v.actor === p ? 'active' : ''} ${connected(p) ? '' : 'away'}`}
                  style={{ background: bg, color: fg }}
                  title={connected(p) ? undefined : 'Déconnecté'}
                >
                  {initial(pl.name)}
                </span>
                <span className="n">{pl.name}</span>
                {role && <span className={`role ${role.cls}`}>{role.text}</span>}
              </div>
              <span className="count">
                {pl.cardCount} carte{pl.cardCount > 1 ? 's' : ''}
              </span>
            </div>
          );
        })}
      </section>

      {/* Talon, tapis, défausse */}
      <section className="middle">
        <div className="deck" aria-label={`Talon : ${v.deckCount} cartes, atout ${SUIT_SYMBOL[v.trumpSuit]}`}>
          <div className="trumpc" style={{ opacity: v.trumpInDeck ? 1 : 0.35 }}>
            <PlayingCard card={v.trumpCard} trump={v.trumpSuit} />
          </div>
          <div className="pile">
            {Array.from({ length: Math.min(Math.max(v.deckCount - 1, 0), 3) }, (_, i) => (
              <PlayingCard key={i} style={{ left: i * 2, top: -i * 2 }} />
            ))}
          </div>
          <div className="cnt">{v.deckCount ? `Talon : ${v.deckCount} carte${v.deckCount > 1 ? 's' : ''}` : 'Talon épuisé'}</div>
        </div>

        <div ref={tableRef} className={`tablezone ${dragging ? 'droppable' : ''}`}>
          <div className="counter" aria-live="polite">
            {shownLinger ? (
              <span className={`pill ${shownLinger.outcome === 'discard' ? 'gold' : 'alert'}`}>
                {shownLinger.outcome === 'discard'
                  ? `${shownLinger.defender === v.you ? 'Tu as' : `${name(shownLinger.defender)} a`} tout battu : à la défausse`
                  : `${shownLinger.defender === v.you ? 'Tu ramasses' : `${name(shownLinger.defender)} ramasse`} ${shownLinger.table.reduce((n, p) => n + (p.defense ? 2 : 1), 0)} cartes`}
              </span>
            ) : (
              <span className="pill">
                Attaque {v.table.length} / {v.maxAttacks}
              </span>
            )}
            <div className="dots" aria-hidden="true">
              {Array.from({ length: v.maxAttacks }, (_, i) => (
                <i key={i} className={i < shownTable.length ? 'on' : ''} />
              ))}
            </div>
          </div>
          <div className="pairs">
            <AnimatePresence custom={exitKind} mode="popLayout">
              {shownTable.map((pair) => {
                const fromYou = pair.by === v.you;
                const unbeaten = !shownLinger && !pair.defense && pair === last && v.phase === 'defend';
                // Cartes ramassées : elles sont peut-être déjà dans ta main, pas d'animation partagée.
                const shared = !shownLinger || shownLinger.outcome === 'discard';
                return (
                  <motion.div
                    key={cardKey(pair.attack)}
                    className="pair"
                    custom={exitKind}
                    variants={pairVariants}
                    exit="exit"
                    layout
                  >
                    <PlayingCard
                      layoutId={shared ? `c-${cardKey(pair.attack)}` : undefined}
                      card={pair.attack}
                      trump={v.trumpSuit}
                      className={unbeaten ? 'target' : ''}
                      initial={fromYou ? undefined : { opacity: 0, y: -120, scale: 0.7 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                    />
                    {pair.defense && (
                      <PlayingCard
                        layoutId={shared ? `c-${cardKey(pair.defense)}` : undefined}
                        card={pair.defense}
                        trump={v.trumpSuit}
                        className="def"
                        initial={tableDefender === v.you ? undefined : { opacity: 0, y: -80, rotate: 0 }}
                        animate={{ opacity: 1, y: 0, rotate: 8 }}
                      />
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {Array.from({ length: Math.max(0, Math.min(3, v.maxAttacks - shownTable.length)) }, (_, i) => (
              <div key={`slot-${i}`} className="pair slot" aria-hidden="true" />
            ))}
          </div>
        </div>

        <div className="side">
          <div className="mobile-info">
            <PlayingCard card={v.trumpCard} trump={v.trumpSuit} />
            <span>Talon {v.deckCount}</span>
          </div>
          <div className="discard">
            <div className="stackd" aria-hidden="true">
              {v.discardCount > 0 &&
                [0, 1, 2].slice(0, Math.min(3, Math.ceil(v.discardCount / 4))).map((i) => (
                  <PlayingCard key={i} style={{ rotate: `${i * 9 - 8}deg` }} />
                ))}
            </div>
            <span>Défausse : {v.discardCount}</span>
          </div>
          <GameLog view={v} name={name} />
        </div>
      </section>

      {/* Ta main et tes actions */}
      <section className="me" aria-label="Ta main">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
          <div className="who">
            <span
              className={`av ${v.actor === v.you ? 'active' : ''}`}
              style={{ background: avatarColors(v.you)[0], color: avatarColors(v.you)[1] }}
            >
              {initial(me?.name ?? '')}
            </span>
            {me?.name} (toi)
            {roleOf(v.you) && <span className={`role ${roleOf(v.you)!.cls}`}>{roleOf(v.you)!.text}</span>}
          </div>
          <div className="hand" style={{ '--overlap': `${overlap}px` } as React.CSSProperties}>
            <AnimatePresence>
              {v.hand.map((c) => {
                const ok = yourTurn && isLegal(c);
                const isSel = sameCard(c, selected);
                const blocked = v.blocked.some((b) => sameCard(b, c)) && v.phase === 'attack';
                const cls = [
                  ok ? 'playable' : yourTurn ? 'dim' : '',
                  isSel ? 'selected' : '',
                  blocked ? 'blocked' : '',
                ].join(' ');
                return (
                  <PlayingCard
                    key={cardKey(c)}
                    layoutId={`c-${cardKey(c)}`}
                    card={c}
                    trump={v.trumpSuit}
                    className={cls}
                    style={{ zIndex: isSel ? 5 : undefined }}
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: isSel ? -28 : ok ? -14 : 0 }}
                    whileHover={ok ? { y: isSel ? -30 : -22 } : undefined}
                    exit={{ opacity: 0 }}
                    drag={ok}
                    dragSnapToOrigin
                    dragElastic={0.9}
                    onDragStart={() => setDragging(true)}
                    onDragEnd={(_, info) => onDragEnd(c, info)}
                    onClick={() => ok && (isSel ? play(c) : setSelected(c))}
                    onDoubleClick={() => ok && play(c)}
                    tabIndex={ok ? 0 : -1}
                    onKeyDown={(e) => ok && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), isSel ? play(c) : setSelected(c))}
                    aria-pressed={ok ? isSel : undefined}
                  />
                );
              })}
            </AnimatePresence>
          </div>
        </div>

        <div className="actions">
          <div className={`prompt ${prompt.yours ? 'yours' : ''}`} aria-live="polite">
            {prompt.node}
          </div>
          {room.deadline && v.phase !== 'finished' && <TurnTimer deadline={room.deadline} offset={clockOffset} />}
          {yourTurn && (
            <div className="row">
              {v.legal.canTake && (
                <button type="button" className="btn danger" onClick={() => act({ type: 'take' })}>
                  Ramasser
                </button>
              )}
              {v.legal.canPass && (
                <button type="button" className="btn ghost" onClick={() => act({ type: 'pass' })}>
                  Passer
                </button>
              )}
              {legal.length > 0 && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={!selected}
                  onClick={() => selected && play(selected)}
                >
                  {!selected
                    ? 'Choisis une carte'
                    : v.phase === 'defend'
                      ? `Battre avec ${cardLabel(selected)}`
                      : v.table.length === 0
                        ? `Attaquer avec ${cardLabel(selected)}`
                        : `Relancer ${cardLabel(selected)}`}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash}
            className="flash"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
          >
            {flash}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Choix de l'attaquant par le premier défenseur */}
      {v.legal.chooseTargets.length > 0 && (
        <Modal label="Choisis ton attaquant">
          <h2>Tu défends en premier</h2>
          <p>
            {firstReason(v)} Choisis lequel de tes voisins t’attaque.
          </p>
          <div className="choices">
            {v.legal.chooseTargets.map((t) => {
              const [bg, fg] = avatarColors(t);
              const side = t === (v.you + 1) % n ? 'à ta gauche' : 'à ta droite';
              return (
                <button key={t} type="button" className="choice" onClick={() => act({ type: 'chooseAttacker', target: t })}>
                  <span className="av" style={{ background: bg, color: fg }}>
                    {initial(name(t))}
                  </span>
                  {name(t)}
                  <small>{v.legal.chooseTargets.length > 1 ? side : 'ton voisin'}</small>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {/* Fin de partie */}
      {v.phase === 'finished' && (
        <Modal label="Fin de partie">
          <PlayingCard style={{ margin: '0 auto', rotate: '-8deg' }} size={40} />
          <h2>
            {v.durak === v.you ? 'Tu es le durak !' : `${name(v.durak ?? -1)} est le durak`}
          </h2>
          <div className="rank">
            {v.players
              .map((p, i) => ({ ...p, i }))
              .filter((p) => p.place !== null)
              .sort((a, b) => a.place! - b.place!)
              .map((p) => (
                <div key={p.id}>
                  <span className="pos">{p.place! + 1}</span>
                  {p.name}
                  {p.i === v.you ? ' (toi)' : ''}
                </div>
              ))}
            {v.durak !== null && (
              <div className="durak">
                <span className="pos">✕</span>
                {name(v.durak)}
                {v.durak === v.you ? ' (toi)' : ''} · {v.players[v.durak].cardCount} carte
                {v.players[v.durak].cardCount > 1 ? 's' : ''} en main
              </div>
            )}
          </div>
          <div className="buttons">
            <button type="button" className="btn ghost" onClick={leave}>
              Quitter
            </button>
            {isHost ? (
              <>
                <button type="button" className="btn ghost" onClick={() => toLobby()}>
                  Retour au salon
                </button>
                <button type="button" className="btn primary" onClick={() => start()}>
                  Revanche
                </button>
              </>
            ) : (
              <span className="hint" style={{ alignSelf: 'center' }}>
                L’hôte peut lancer la revanche.
              </span>
            )}
          </div>
          {v.durak !== null && (
            <p className="hint">À la revanche, {v.durak === v.you ? 'tu défendras' : `${name(v.durak)} défendra`} en premier.</p>
          )}
        </Modal>
      )}

      {confirmLeave && (
        <Modal label="Quitter la partie" onClose={() => setConfirmLeave(false)}>
          <h2>Quitter la partie ?</h2>
          <p>Ta place reste à la table : le serveur jouera à ta place jusqu’à la fin, puis ta place sera libérée.</p>
          <div className="buttons">
            <button type="button" className="btn ghost" onClick={() => setConfirmLeave(false)}>
              Rester
            </button>
            <button type="button" className="btn danger" onClick={leave}>
              Quitter
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function firstReason(v: PlayerView): string {
  const start = v.log.find((e) => e.t === 'start');
  if (start?.t !== 'start') return '';
  if (start.reason === 'durak') return 'Tu étais le durak de la dernière partie.';
  if (start.reason === 'lowestTrump') {
    const lowest = v.hand.filter((c) => c.s === v.trumpSuit).sort((a, b) => a.r - b.r)[0];
    return lowest ? `Tu as l’atout le plus faible : ${cardLabel(lowest)}.` : 'Tu as l’atout le plus faible.';
  }
  return 'Personne n’a d’atout : le sort t’a désigné.';
}

function GameLog({ view, name }: { view: PlayerView; name: (p: number) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [view.logSize]);
  const items = useMemo(() => view.log.slice(-14).map((e) => logText(e, name)), [view.logSize]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="log" ref={ref} aria-label="Historique">
      {items.map((l, i) => (
        <span key={view.logSize - items.length + i} className={l.tone === 'red' ? 'red' : ''}>
          {l.who && <b>{l.who} </b>}
          {l.text}
        </span>
      ))}
    </div>
  );
}

function TurnTimer({ deadline, offset }: { deadline: number; offset: number }) {
  const total = useRef({ deadline, ms: Math.max(1, deadline - (Date.now() + offset)) });
  if (total.current.deadline !== deadline) total.current = { deadline, ms: Math.max(1, deadline - (Date.now() + offset)) };
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, deadline - (now + offset));
  const frac = Math.min(1, left / total.current.ms);
  return (
    <div className={`timer ${left < 5000 ? 'low' : ''}`} role="timer" aria-label={`${Math.ceil(left / 1000)} secondes restantes`}>
      <i style={{ width: `${frac * 100}%` }} />
    </div>
  );
}
