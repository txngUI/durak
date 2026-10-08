import {
  type Action,
  type Card,
  type LastRound,
  type PlayerView,
  type RoomView,
  SUIT_NAME,
  SUIT_SYMBOL,
  cardLabel,
  isRed,
  sortHandBySuit,
} from '@durak/engine';
import { AnimatePresence, type PanInfo, type TargetAndTransition, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { avatarColors, cardKey, initial, logText, promptFor, sameCard } from '../format';
import { useStore } from '../store';
import { Confetti, Medal } from './Celebration';
import { Chat, useUnreadChat } from './Chat';
import { FLIGHT_SECONDS, type Flight, Flights } from './Flights';
import { HostBadge } from './HostBadge';
import { Modal } from './Modal';
import { PlayingCard } from './PlayingCard';

type Exit = 'take' | 'discard';

const SORT_KEY = 'durak.sort';

/** Durée d'affichage des cartes d'un pli terminé avant qu'elles partent. */
const LINGER_MS = 2400;

/** Durée du vol des cartes d'un pli vers la défausse ou vers celui qui ramasse. */
const EXIT_SECONDS = 0.5;

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
/** Rectangle du premier élément réellement affiché (certains sont masqués sur mobile). */
const visibleRect = (...els: (Element | null | undefined)[]) => {
  for (const el of els) {
    const r = el?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) return r;
  }
  return null;
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
  const { act, leave, toLobby } = useStore();
  const clockOffset = useStore((s) => s.clockOffset);
  const name = (p: number) => v.players[p]?.name ?? '?';
  const colorOf = (p: number) => room.gameColors[p] ?? p;
  const connected = (p: number) => room.players.find((x) => x.id === room.gamePlayerIds[p])?.connected ?? false;
  const n = v.players.length;
  const me = v.players[v.you];

  // --- Sélection et coups légaux --------------------------------------------
  const legal: Card[] = v.phase === 'defend' ? v.legal.defend : v.phase === 'attack' ? v.legal.attack : [];
  const yourTurn = v.actor === v.you && (v.phase === 'attack' || v.phase === 'defend');
  const [selected, setSelected] = useState<Card | null>(null);
  const turnKey = `${v.round}-${v.phase}-${v.actor}-${v.table.length}`;
  useEffect(() => setSelected(null), [turnKey]);
  const isLegal = (c: Card) => legal.some((l) => sameCard(l, c));

  // Une seule action envoyée par tour : un clic de trop (double-clic, bouton martelé)
  // ne doit pas partir au serveur et revenir en message d'erreur.
  const sentFor = useRef<string | null>(null);
  const send = async (a: Action) => {
    if (sentFor.current === turnKey) return;
    sentFor.current = turnKey;
    if (!(await act(a))) sentFor.current = null;
  };

  const play = (card: Card) => {
    if (!isLegal(card)) return;
    setSelected(null);
    send(v.phase === 'defend' ? { type: 'defend', card } : { type: 'attack', card });
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
  useLayoutEffect(() => {
    const fresh = v.log.slice(-Math.min(v.logSize - prevLog.current, v.log.length));
    prevLog.current = v.logSize;
    if (fresh.length === 0) return;
    let message: string | null = null;
    for (const e of fresh) {
      if (e.t === 'out' && e.place === 0) {
        message = e.p === v.you ? 'Tu es le Korol !' : `${name(e.p)} est le Korol !`;
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

  // --- Animations : fin de pli, défausse, ramassage, pioche, donne ----------
  const reduceMotion = useReducedMotion();
  const deckAnchorRef = useRef<HTMLDivElement>(null);
  const mobileDeckRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const discardTextRef = useRef<HTMLSpanElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const oppEls = useRef(new Map<number, HTMLElement>());
  const pairEls = useRef(new Map<string, HTMLElement>());
  const handEls = useRef(new Map<string, HTMLElement>());

  // Cartes de ta main gardées invisibles jusqu'à l'arrivée de leur animation.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const reveal = (keys: string[]) =>
    setHidden((h) => {
      const next = new Set(h);
      for (const k of keys) next.delete(k);
      return next;
    });
  const [flights, setFlights] = useState<Flight[]>([]);
  const flightSeq = useRef(0);
  type PendingDraw = { draws: { p: number; n: number }[]; mine: string[]; taken: string[] };
  const pendingDraw = useRef<PendingDraw | null>(null);
  const exitInfo = useRef<{ kind: Exit; defender: number }>({ kind: 'discard', defender: -1 });

  /** Lance le vol des cartes piochées, de la pioche vers chaque joueur, dans l'ordre de pioche. */
  const launchDraws = (pd: PendingDraw, startDelay: number) => {
    setTimeout(() => reveal(pd.taken), (startDelay * 1000) / 2);
    const from = visibleRect(deckAnchorRef.current, mobileDeckRef.current);
    if (!from) {
      reveal(pd.mine);
      return;
    }
    const out: Flight[] = [];
    let i = 0;
    let mineIdx = 0;
    for (const d of pd.draws) {
      for (let k = 0; k < d.n; k++) {
        const id = `f${++flightSeq.current}`;
        const delay = startDelay + i++ * 0.1;
        if (d.p === v.you) {
          const key = pd.mine[mineIdx++];
          const to = visibleRect(key ? handEls.current.get(key) : null, handRef.current);
          if (to) out.push({ id, from, to, delay, fade: false, reveal: key });
          else if (key) reveal([key]);
        } else {
          const to = visibleRect(oppEls.current.get(d.p));
          if (to) out.push({ id, from, to, delay, fade: true });
        }
      }
    }
    reveal(pd.mine.slice(mineIdx));
    setFlights((f) => [...f, ...out]);
  };

  // Donne de début de partie : 6 cartes à chacun, 2 par 2.
  useEffect(() => {
    if (reduceMotion || v.round !== 1 || v.lastRound || v.table.length || v.logSize > 2) return;
    const mine = v.hand.map(cardKey);
    setHidden(new Set(mine));
    const draws = [0, 1, 2].flatMap(() => v.players.map((_, p) => ({ p, n: 2 })));
    // Laisse le temps aux éléments de se placer avant de mesurer.
    const t = setTimeout(() => launchDraws({ draws, mine, taken: [] }, 0.1), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pli terminé : on garde ses cartes visibles un instant, puis elles partent et on pioche.
  const [linger, setLinger] = useState<LastRound | null>(null);
  const seenRound = useRef(v.lastRound?.round ?? 0);
  const prevHand = useRef(new Set(v.hand.map(cardKey)));
  useLayoutEffect(() => {
    const lr = v.lastRound;
    if (!lr || lr.round === seenRound.current) return;
    seenRound.current = lr.round;
    exitInfo.current = { kind: lr.outcome, defender: lr.defender };
    const fresh = v.hand.map(cardKey).filter((k) => !prevHand.current.has(k));
    const tableKeys = new Set(lr.table.flatMap((p) => (p.defense ? [p.attack, p.defense] : [p.attack])).map(cardKey));
    const taken = lr.outcome === 'take' && lr.defender === v.you ? fresh.filter((k) => tableKeys.has(k)) : [];
    if (!reduceMotion && v.phase !== 'finished') {
      setHidden(new Set(fresh));
      pendingDraw.current = { draws: lr.draws, mine: fresh.filter((k) => !taken.includes(k)), taken };
    }
    setLinger(lr);
    const t = setTimeout(() => setLinger(null), LINGER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.lastRound?.round]);
  useEffect(() => {
    prevHand.current = new Set(v.hand.map(cardKey));
  });

  // Dès qu'une nouvelle carte est posée, le pli suivant prend la place.
  const shownLinger = linger && v.table.length === 0 && v.phase !== 'finished' ? linger : null;
  const shownTable = shownLinger ? shownLinger.table : v.table;
  const tableDefender = shownLinger ? shownLinger.defender : v.defender;
  const lingering = !!shownLinger;
  useEffect(() => {
    if (lingering || !pendingDraw.current) return;
    const pd = pendingDraw.current;
    pendingDraw.current = null;
    launchDraws(pd, EXIT_SECONDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lingering]);
  // Filet de sécurité (onglet en arrière-plan, animations suspendues) : rien ne reste caché.
  useEffect(() => {
    if (hidden.size === 0 && flights.length === 0) return;
    const t = setTimeout(() => {
      setHidden(new Set());
      setFlights([]);
    }, LINGER_MS + 4000);
    return () => clearTimeout(t);
  }, [hidden, flights]);

  /** Vol d'une paire de cartes vers la défausse, ou vers celui qui ramasse. */
  const exitFor = (key: string) => (): TargetAndTransition => {
    const el = pairEls.current.get(key);
    const { kind, defender } = exitInfo.current;
    const target =
      kind === 'take'
        ? defender === v.you
          ? visibleRect(handRef.current)
          : visibleRect(oppEls.current.get(defender))
        : visibleRect(discardRef.current, discardTextRef.current);
    if (!el || !target || reduceMotion) return { opacity: 0, transition: { duration: 0.2 } };
    const a = center(el.getBoundingClientRect());
    const b = center(target);
    return {
      x: b.x - a.x,
      y: b.y - a.y,
      scale: kind === 'take' ? 0.45 : 0.7,
      rotate: kind === 'discard' ? 30 : -12,
      opacity: [1, 1, 0],
      transition: { duration: EXIT_SECONDS, ease: [0.4, 0, 0.2, 1] as const },
    };
  };

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
  // Tri de la main au choix du joueur, retenu sur cet appareil.
  const [sortMode, setSortMode] = useState<'rank' | 'suit'>(() => {
    try {
      return localStorage.getItem(SORT_KEY) === 'suit' ? 'suit' : 'rank';
    } catch {
      return 'rank';
    }
  });
  const changeSort = (m: 'rank' | 'suit') => {
    setSortMode(m);
    try {
      localStorage.setItem(SORT_KEY, m);
    } catch {
      /* stockage indisponible : le choix vaut pour cette page seulement */
    }
  };
  const shownHand = sortMode === 'suit' ? sortHandBySuit(v.hand, v.trumpSuit) : v.hand;
  const count = v.hand.length;
  /** Hors de ton tour, les cartes descendent d'un cinquième de leur hauteur. */
  const restDrop = Math.round(cw * 0.3);
  const overlap = count > 1 ? Math.max(-cw * 0.72, Math.min(mobile ? -10 : -14, (avail - count * cw) / (count - 1))) : 0;

  // --- Adversaires, dans l'ordre de la table à partir de ta gauche ----------
  const opponents = Array.from({ length: n - 1 }, (_, i) => (v.you + 1 + i) % n);
  const roleOf = (p: number) => {
    const place = v.players[p].place;
    if (place === 0) return { cls: 'korol', text: '♛ Korol' };
    if (place !== null) return { cls: 'out', text: `Fini · ${place + 1}e` };
    if (v.phase === 'finished') return null;
    if (p === v.defender) return { cls: 'def', text: v.phase === 'chooseAttacker' ? 'choisit' : 'défend' };
    if (p === v.attacker) return { cls: 'att', text: 'attaque' };
    if (p === v.actor) return { cls: 'att', text: 'relance' };
    return null;
  };

  const korol = v.players.findIndex((p) => p.place === 0);
  const unread = useUnreadChat(room);
  const [mobilePanel, setMobilePanel] = useState(false);

  // Annonce de l'atout en grand, une fois la donne terminée.
  const freshStart = v.round === 1 && !v.lastRound && v.table.length === 0 && v.logSize <= 2;
  const [intro, setIntro] = useState(freshStart);
  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => setIntro(false), reduceMotion ? 1500 : 4300);
    return () => clearTimeout(t);
  }, [intro, reduceMotion]);

  // Fenêtre quand tu termines avant la fin de la partie.
  const myPlace = me?.place ?? null;
  const [outSeen, setOutSeen] = useState(myPlace !== null);
  const showOut = myPlace !== null && !outSeen && v.phase !== 'finished';
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
          <button type="button" className="icon-btn chat-btn" onClick={() => setMobilePanel(true)}>
            Chat{unread > 0 && <span className="badge">{unread}</span>}
          </button>
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
          const [bg, fg] = avatarColors(colorOf(p));
          const role = roleOf(p);
          const pl = v.players[p];
          return (
            <div
              key={p}
              ref={(el) => {
                if (el) oppEls.current.set(p, el);
              }}
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
                {room.gamePlayerIds[p] === room.hostId && <HostBadge />}
                {role && <span className={`role ${role.cls}`}>{role.text}</span>}
              </div>
              <span className="count">
                {pl.cardCount} carte{pl.cardCount > 1 ? 's' : ''}
              </span>
            </div>
          );
        })}
      </section>

      {/* Pioche, tapis, défausse */}
      <section className="middle">
        <div className="deck" aria-label={`Pioche : ${v.deckCount} cartes, atout ${SUIT_SYMBOL[v.trumpSuit]}`}>
          <div className="trumpc" style={{ opacity: v.trumpInDeck ? 1 : 0.35 }}>
            <PlayingCard card={v.trumpCard} trump={v.trumpSuit} />
          </div>
          <div className="pile">
            {Array.from({ length: Math.min(Math.max(v.deckCount - 1, 0), 3) }, (_, i) => (
              <PlayingCard key={i} style={{ left: i * 2, top: -i * 2 }} />
            ))}
          </div>
          <div ref={deckAnchorRef} className="deck-anchor" aria-hidden="true" />
          <div className="cnt">{v.deckCount ? `Pioche : ${v.deckCount} carte${v.deckCount > 1 ? 's' : ''}` : 'Pioche vide'}</div>
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
            <AnimatePresence mode="popLayout">
              {shownTable.map((pair) => {
                const fromYou = pair.by === v.you;
                const unbeaten = !shownLinger && !pair.defense && pair === last && v.phase === 'defend';
                // Cartes ramassées : elles sont peut-être déjà dans ta main, pas d'animation partagée.
                const shared = !shownLinger || shownLinger.outcome === 'discard';
                return (
                  <motion.div
                    key={cardKey(pair.attack)}
                    ref={(el: HTMLDivElement | null) => {
                      if (el) pairEls.current.set(cardKey(pair.attack), el);
                    }}
                    className="pair"
                    variants={{ exit: exitFor(cardKey(pair.attack)) }}
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
            {/* Un seul emplacement libre, pour la prochaine carte d'attaque. */}
            {Array.from({ length: !shownLinger && shownTable.length < v.maxAttacks ? 1 : 0 }, (_, i) => (
              <div key={`slot-${i}`} className="pair slot" aria-hidden="true" />
            ))}
          </div>
        </div>

        <div className="side">
          <div className="mobile-info">
            <div ref={mobileDeckRef}>
              <PlayingCard card={v.trumpCard} trump={v.trumpSuit} />
            </div>
            <span>Pioche {v.deckCount}</span>
          </div>
          <div className="discard">
            <div ref={discardRef} className="stackd" aria-hidden="true">
              {v.discardCount > 0 &&
                [0, 1, 2].slice(0, Math.min(3, Math.ceil(v.discardCount / 4))).map((i) => (
                  <PlayingCard key={i} style={{ rotate: `${i * 9 - 8}deg` }} />
                ))}
            </div>
            <span ref={discardTextRef}>Défausse : {v.discardCount}</span>
          </div>
          <SidePanel room={room} view={v} name={name} />
        </div>
      </section>

      {/* Ta main et tes actions */}
      <section className="me" aria-label="Ta main">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
          <div className="who">
            <span
              className={`av ${v.actor === v.you ? 'active' : ''}`}
              style={{ background: avatarColors(colorOf(v.you))[0], color: avatarColors(colorOf(v.you))[1] }}
            >
              {initial(me?.name ?? '')}
            </span>
            {me?.name} (toi)
            {room.you === room.hostId && <HostBadge />}
            {roleOf(v.you) && <span className={`role ${roleOf(v.you)!.cls}`}>{roleOf(v.you)!.text}</span>}
          </div>
          <div className="hand-tools" role="radiogroup" aria-label="Trier ma main">
            <span>Trier :</span>
            <button type="button" role="radio" aria-checked={sortMode === 'rank'} onClick={() => changeSort('rank')}>
              par valeur
            </button>
            <button type="button" role="radio" aria-checked={sortMode === 'suit'} onClick={() => changeSort('suit')}>
              par couleur
            </button>
          </div>
          <div ref={handRef} className="hand" style={{ '--overlap': `${overlap}px` } as React.CSSProperties}>
            <AnimatePresence>
              {shownHand.map((c) => {
                const ok = yourTurn && isLegal(c);
                const isSel = sameCard(c, selected);
                const blocked = v.blocked.some((b) => sameCard(b, c)) && v.phase === 'attack';
                const cls = [
                  // Ton tour : jouables levées, les autres grisées. Sinon la main est « rangée ».
                  ok ? 'playable' : yourTurn ? 'dim' : 'resting',
                  isSel ? 'selected' : '',
                  blocked ? 'blocked' : '',
                ].join(' ');
                return (
                  <PlayingCard
                    key={cardKey(c)}
                    ref={(el: HTMLDivElement | null) => {
                      if (el) handEls.current.set(cardKey(c), el);
                    }}
                    layoutId={`c-${cardKey(c)}`}
                    card={c}
                    trump={v.trumpSuit}
                    className={cls}
                    // Masquée sans animation : reste fiable même si l'onglet est en arrière-plan.
                    style={{ zIndex: isSel ? 5 : undefined, visibility: hidden.has(cardKey(c)) ? 'hidden' : undefined }}
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: isSel ? -28 : ok ? -14 : yourTurn ? 0 : restDrop }}
                    whileHover={ok ? { y: isSel ? -30 : -22 } : undefined}
                    exit={{ opacity: 0 }}
                    drag={ok}
                    dragSnapToOrigin
                    dragElastic={0.9}
                    onDragStart={() => setDragging(true)}
                    onDragEnd={(_, info) => onDragEnd(c, info)}
                    onClick={() => ok && (isSel ? play(c) : setSelected(c))}
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
                <button type="button" className="btn danger" onClick={() => send({ type: 'take' })}>
                  Ramasser
                </button>
              )}
              {v.legal.canPass && (
                <button type="button" className="btn ghost" onClick={() => send({ type: 'pass' })}>
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

      <Flights
        flights={flights}
        onLand={(f) => {
          setFlights((all) => all.filter((x) => x.id !== f.id));
          if (f.reveal) reveal([f.reveal]);
        }}
      />

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

      {/* Annonce de l'atout */}
      <AnimatePresence>
        {intro && (
          <motion.div
            className="trump-intro"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: reduceMotion ? 0 : 2.2, duration: 0.3 }}
          >
            <motion.div
              initial={{ rotateY: 180, scale: 0.4 }}
              animate={{ rotateY: 0, scale: 1 }}
              transition={{ delay: reduceMotion ? 0 : 2.3, duration: 0.7, type: 'spring', stiffness: 120, damping: 14 }}
            >
              <PlayingCard card={v.trumpCard} trump={v.trumpSuit} size={150} />
            </motion.div>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: reduceMotion ? 0 : 2.7 }}
            >
              Atout <span className={isRed(v.trumpSuit) ? 'red' : ''}>{SUIT_SYMBOL[v.trumpSuit]}</span> {SUIT_NAME[v.trumpSuit]}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tu as terminé avant la fin de la partie */}
      {showOut && myPlace === 0 && <Confetti />}
      {showOut && (
        <Modal label="Tu as terminé" onClose={() => setOutSeen(true)}>
          <Medal kind={myPlace === 0 ? 'korol' : 'done'} />
          <h2>{myPlace === 0 ? 'Tu es le Korol !' : 'Tu t’en es sorti !'}</h2>
          <p>
            {myPlace === 0
              ? 'Premier à vider ta main : la couronne est à toi.'
              : `Tu termines ${myPlace! + 1}e. Le durak n’est pas encore désigné…`}
          </p>
          <div className="buttons">
            <button type="button" className="btn primary" onClick={() => setOutSeen(true)}>
              Regarder la fin de la partie
            </button>
          </div>
        </Modal>
      )}

      {/* Panneau historique / chat en plein écran sur mobile */}
      {mobilePanel && (
        <Modal label="Chat et historique" onClose={() => setMobilePanel(false)} wide>
          <SidePanel room={room} view={v} name={name} initialTab="chat" />
          <div className="buttons">
            <button type="button" className="btn ghost" onClick={() => setMobilePanel(false)}>
              Fermer
            </button>
          </div>
        </Modal>
      )}

      {/* Choix de l'attaquant par le premier défenseur */}
      {v.legal.chooseTargets.length > 0 && !intro && (
        <Modal label="Choisis ton attaquant">
          <h2>Tu défends en premier</h2>
          <p>
            {firstReason(v)} Choisis lequel de tes voisins t’attaque.
          </p>
          <div className="choices">
            {v.legal.chooseTargets.map((t) => {
              const [bg, fg] = avatarColors(colorOf(t));
              const side = t === (v.you + 1) % n ? 'à ta gauche' : 'à ta droite';
              return (
                <button key={t} type="button" className="choice" onClick={() => send({ type: 'chooseAttacker', target: t })}>
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

      {/* Fin de partie : reste affichée jusqu'à ce que le joueur revienne au salon */}
      {v.phase === 'finished' && korol === v.you && <Confetti />}
      {v.phase === 'finished' && (
        <Modal label="Fin de partie">
          <Medal kind={v.durak === v.you ? 'durak' : korol === v.you ? 'korol' : 'done'} />
          <span className="eyebrow">Partie terminée en {v.round} plis</span>
          <div className="verdict">
            {korol >= 0 && (
              <div className="korol">
                <span className="tag">Korol</span>
                <b>{korol === v.you ? 'Toi !' : name(korol)}</b>
              </div>
            )}
            {v.durak !== null && (
              <div className="durak-box">
                <span className="tag">Durak</span>
                <b>{v.durak === v.you ? 'Toi…' : name(v.durak)}</b>
              </div>
            )}
          </div>
          <div className="rank">
            {v.players
              .map((p, i) => ({ ...p, i }))
              .filter((p) => p.place !== null)
              .sort((a, b) => a.place! - b.place!)
              .map((p) => (
                <div key={p.id} className={p.place === 0 ? 'korol-row' : ''}>
                  <span className="pos">{p.place! + 1}</span>
                  {p.name}
                  {p.i === v.you ? ' (toi)' : ''}
                  {p.place === 0 && <span className="rank-tag">Korol</span>}
                </div>
              ))}
            {v.durak !== null && (
              <div className="durak">
                <span className="pos">✕</span>
                {name(v.durak)}
                {v.durak === v.you ? ' (toi)' : ''} · {v.players[v.durak].cardCount} carte
                {v.players[v.durak].cardCount > 1 ? 's' : ''} en main
                <span className="rank-tag">Durak</span>
              </div>
            )}
          </div>
          <div className="buttons">
            <button type="button" className="btn ghost" onClick={leave}>
              Quitter
            </button>
            <button type="button" className="btn primary" onClick={() => toLobby()}>
              Retour au salon
            </button>
          </div>
          <p className="hint">
            Prends ton temps : la prochaine partie attend que tout le monde soit revenu au salon.
            {v.durak !== null && <> {v.durak === v.you ? 'Tu défendras' : `${name(v.durak)} défendra`} en premier.</>}
          </p>
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

/** Panneau latéral : bascule entre l'historique de la partie et le chat. */
function SidePanel({
  room,
  view,
  name,
  initialTab = 'log',
}: {
  room: RoomView;
  view: PlayerView;
  name: (p: number) => string;
  initialTab?: 'log' | 'chat';
}) {
  const [tab, setTab] = useState<'log' | 'chat'>(initialTab);
  const unread = useUnreadChat(room);
  return (
    <div className="side-panel">
      <div className="tabs" role="tablist" aria-label="Historique ou chat">
        <button type="button" role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>
          Historique
        </button>
        <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
          Chat{unread > 0 && tab !== 'chat' && <span className="badge">{unread}</span>}
        </button>
      </div>
      {tab === 'log' ? <GameLog view={view} name={name} /> : <Chat room={room} autoFocus={initialTab === 'chat'} />}
    </div>
  );
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
