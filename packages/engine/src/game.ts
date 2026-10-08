import {
  type Card,
  type Rank,
  type Suit,
  RANKS,
  SUITS,
  beats,
  cardId,
  createRng,
  fullDeck,
  sameCard,
  shuffle,
} from './cards';

export const HAND_SIZE = 6;
export const MAX_ATTACKS = 6;
/** Une carte posée en attaque sur ce nombre de plis consécutifs est bloquée au pli suivant. */
export const MAX_ATTACK_STREAK = 2;

export type Phase = 'chooseAttacker' | 'attack' | 'defend' | 'finished';

export interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
  /** Place de sortie (0 = premier sorti), null tant que le joueur a des cartes. */
  place: number | null;
}

export interface TablePair {
  attack: Card;
  defense: Card | null;
  /** Joueur qui a posé la carte d'attaque. */
  by: number;
}

export type LogEntry =
  | { t: 'start'; defender: number; reason: 'durak' | 'lowestTrump' | 'random'; trump: Card }
  | { t: 'chooseAttacker'; defender: number; attacker: number }
  | { t: 'attack'; p: number; card: Card; relance: boolean }
  | { t: 'defend'; p: number; card: Card; on: Card }
  | { t: 'pass'; p: number }
  | { t: 'take'; p: number; count: number }
  | { t: 'discard'; count: number }
  | { t: 'noAttack'; p: number }
  | { t: 'out'; p: number; place: number }
  | { t: 'end'; durak: number | null };

export interface GameState {
  players: PlayerState[];
  /** Talon : la dernière case est le dessus, la case 0 est la carte d'atout retournée. */
  deck: Card[];
  trumpCard: Card;
  trumpSuit: Suit;
  discardCount: number;
  phase: Phase;
  /** Numéro du pli en cours (commence à 1). */
  round: number;
  /** Attaquant principal du pli. */
  attacker: number;
  defender: number;
  /** Sens de rotation : l'attaquant est le voisin du défenseur à `defender + step`. */
  step: 1 | -1;
  /** Joueur qui doit agir maintenant (-1 si partie terminée). */
  actor: number;
  table: TablePair[];
  /** Joueurs ayant passé pendant ce pli : ils ne peuvent plus relancer jusqu'au pli suivant. */
  passed: number[];
  /** Série d'attaques par carte, pour la règle des 3 poses d'affilée. */
  attackStreaks: Record<string, { round: number; count: number }>;
  /** Dernier pli terminé, pour que l'interface puisse le montrer un instant. */
  lastRound: LastRound | null;
  durak: number | null;
  log: LogEntry[];
}

export interface LastRound {
  round: number;
  table: TablePair[];
  defender: number;
  outcome: 'discard' | 'take';
}

export type Action =
  | { type: 'chooseAttacker'; target: number }
  | { type: 'attack'; card: Card }
  | { type: 'defend'; card: Card }
  | { type: 'take' }
  | { type: 'pass' };

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };

export interface NewGameOptions {
  seed?: number;
  /** Durak de la partie précédente : il défend en premier s'il joue. */
  previousDurakId?: string | null;
}

// ---------------------------------------------------------------------------
// Mise en place
// ---------------------------------------------------------------------------

export function createGame(
  players: { id: string; name: string }[],
  opts: NewGameOptions = {},
): GameState {
  if (players.length < 2 || players.length > 6) throw new Error('Il faut entre 2 et 6 joueurs');
  const rng = createRng(opts.seed ?? Math.floor(Math.random() * 2 ** 32));
  const deck = shuffle(fullDeck(), rng);
  const n = players.length;
  const hands: Card[][] = players.map(() => []);

  // Distribution 2 par 2 jusqu'à 6 cartes.
  let lastDealt: Card | null = null;
  for (let pass = 0; pass < HAND_SIZE / 2; pass++) {
    for (let p = 0; p < n; p++) {
      for (let k = 0; k < 2; k++) {
        lastDealt = deck.pop()!;
        hands[p].push(lastDealt);
      }
    }
  }

  // La carte suivante est retournée sous le tas. À 6 joueurs le talon est vide :
  // la dernière carte distribuée est montrée et donne l'atout (elle reste en main).
  let trumpCard: Card;
  if (deck.length > 0) {
    trumpCard = deck.pop()!;
    deck.unshift(trumpCard);
  } else {
    trumpCard = lastDealt!;
  }
  const trumpSuit = trumpCard.s;

  // Premier défenseur : durak précédent, sinon atout le plus faible, sinon au hasard.
  let defender = -1;
  let reason: 'durak' | 'lowestTrump' | 'random' = 'random';
  if (opts.previousDurakId) {
    defender = players.findIndex((p) => p.id === opts.previousDurakId);
    if (defender >= 0) reason = 'durak';
  }
  if (defender < 0) {
    let lowest: Rank | 99 = 99;
    hands.forEach((h, p) => {
      for (const c of h) {
        if (c.s === trumpSuit && c.r < lowest) {
          lowest = c.r;
          defender = p;
        }
      }
    });
    if (defender >= 0) reason = 'lowestTrump';
  }
  if (defender < 0) defender = Math.floor(rng() * n);

  const state: GameState = {
    players: players.map((p, i) => ({ id: p.id, name: p.name, hand: hands[i], place: null })),
    deck,
    trumpCard,
    trumpSuit,
    discardCount: 0,
    phase: 'chooseAttacker',
    round: 1,
    attacker: -1,
    defender,
    step: 1,
    actor: defender,
    table: [],
    passed: [],
    attackStreaks: {},
    lastRound: null,
    durak: null,
    log: [{ t: 'start', defender, reason, trump: trumpCard }],
  };

  // À 2 joueurs, il n'y a qu'un voisin : pas de choix à faire.
  if (n === 2) setAttacker(state, (defender + 1) % 2);
  return state;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mod = (a: number, n: number) => ((a % n) + n) % n;
const isIn = (s: GameState, p: number) => s.players[p].place === null;

/** Prochain joueur encore en jeu à partir de `from` dans la direction `dir`. */
export function nextInGame(s: GameState, from: number, dir: 1 | -1): number {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const p = mod(from + dir * k, n);
    if (isIn(s, p)) return p;
  }
  return -1;
}

/** Voisins encore en jeu du défenseur, candidats au rôle d'attaquant. */
export function neighbours(s: GameState, p: number): number[] {
  const a = nextInGame(s, p, 1);
  const b = nextInGame(s, p, -1);
  return a === b ? [a] : [a, b];
}

/**
 * Ordre de la table pour attaquer/relancer : l'attaquant principal puis les autres
 * joueurs en s'éloignant du défenseur. Le défenseur est exclu.
 */
export function throwerOrder(s: GameState): number[] {
  const order: number[] = [];
  let p = s.attacker;
  for (let k = 0; k < s.players.length; k++) {
    if (p !== s.defender && isIn(s, p) && !order.includes(p)) order.push(p);
    p = mod(p + s.step, s.players.length);
  }
  return order;
}

function setAttacker(s: GameState, attacker: number) {
  const n = s.players.length;
  s.attacker = attacker;
  s.step = mod(s.defender + 1, n) === attacker ? 1 : -1;
  s.phase = 'attack';
  s.log.push({ t: 'chooseAttacker', defender: s.defender, attacker });
  beginRound(s);
}

/** Rangs autorisés pour relancer : ceux des deux dernières cartes posées. */
export function relanceRanks(s: GameState): Rank[] | null {
  const last = s.table[s.table.length - 1];
  if (!last || !last.defense) return null;
  return last.attack.r === last.defense.r ? [last.attack.r] : [last.attack.r, last.defense.r];
}

export function isAttackBlocked(s: GameState, card: Card): boolean {
  const streak = s.attackStreaks[cardId(card)];
  return !!streak && streak.round === s.round - 1 && streak.count >= MAX_ATTACK_STREAK;
}

/** Cartes qu'un joueur peut poser en attaque ou en relance maintenant. */
export function attackOptions(s: GameState, p: number): Card[] {
  if (s.phase !== 'attack' || p === s.defender) return [];
  const hand = s.players[p].hand.filter((c) => !isAttackBlocked(s, c));
  if (s.table.length === 0) return hand;
  const ranks = relanceRanks(s) ?? [];
  return hand.filter((c) => ranks.includes(c.r));
}

export function defenseOptions(s: GameState): Card[] {
  if (s.phase !== 'defend') return [];
  const target = s.table[s.table.length - 1].attack;
  return s.players[s.defender].hand.filter((c) => beats(target, c, s.trumpSuit));
}

// ---------------------------------------------------------------------------
// Déroulement
// ---------------------------------------------------------------------------

/** Début d'un pli : l'attaquant ouvre, ou la main passe s'il n'a aucune carte jouable. */
function beginRound(s: GameState) {
  s.table = [];
  s.passed = [];
  for (const p of throwerOrder(s)) {
    if (attackOptions(s, p).length > 0) {
      s.actor = p;
      return;
    }
    s.log.push({ t: 'noAttack', p });
  }
  // Personne ne peut ouvrir (cas extrême lié à la règle des 3 poses) : pli vide.
  endRound(s, true);
}

/** Cherche le prochain joueur qui peut relancer, sinon clôt le pli (défense réussie). */
function nextRelance(s: GameState) {
  if (s.table.length >= MAX_ATTACKS || s.players[s.defender].hand.length === 0) {
    endRound(s, true);
    return;
  }
  s.phase = 'attack';
  for (const p of throwerOrder(s)) {
    if (s.passed.includes(p)) continue;
    // Sans carte de la bonne valeur, on est sauté pour cette relance seulement :
    // une défense suivante peut ouvrir d'autres valeurs.
    if (attackOptions(s, p).length > 0) {
      s.actor = p;
      return;
    }
  }
  endRound(s, true);
}

function endRound(s: GameState, defended: boolean) {
  const cards = s.table.flatMap((pair) => (pair.defense ? [pair.attack, pair.defense] : [pair.attack]));
  if (s.table.length > 0) {
    s.lastRound = { round: s.round, table: s.table, defender: s.defender, outcome: defended ? 'discard' : 'take' };
  }
  if (defended) {
    if (cards.length > 0) {
      s.discardCount += cards.length;
      s.log.push({ t: 'discard', count: cards.length });
    }
  } else {
    s.players[s.defender].hand.push(...cards);
    s.log.push({ t: 'take', p: s.defender, count: cards.length });
  }
  s.table = [];
  s.passed = [];

  // Pioche : attaquant, autres joueurs dans l'ordre, puis défenseur s'il a tout battu.
  const drawOrder = throwerOrder(s);
  if (defended) drawOrder.push(s.defender);
  for (const p of drawOrder) {
    const hand = s.players[p].hand;
    while (hand.length < HAND_SIZE && s.deck.length > 0) hand.push(s.deck.pop()!);
  }

  // Talon vide : ceux qui n'ont plus de cartes sortent du jeu.
  if (s.deck.length === 0) {
    const inGame = s.players.map((_, p) => p).filter((p) => isIn(s, p));
    let leaving = inGame.filter((p) => s.players[p].hand.length === 0);
    // Pas d'égalité : si tout le monde se vide sur le même pli, le défenseur est le durak.
    if (leaving.length === inGame.length) leaving = leaving.filter((p) => p !== s.defender);
    let place = s.players.filter((p) => p.place !== null).length;
    for (const p of leaving) {
      s.players[p].place = place++;
      s.log.push({ t: 'out', p, place: s.players[p].place! });
    }
  }

  const remaining = s.players.map((_, p) => p).filter((p) => isIn(s, p));
  if (remaining.length <= 1) {
    s.phase = 'finished';
    s.actor = -1;
    s.durak = remaining[0] ?? null;
    s.log.push({ t: 'end', durak: s.durak });
    return;
  }

  // Tour suivant : le voisin du dernier attaquant, du côté opposé au défenseur, attaque
  // le joueur en jeu qui le précède (le dernier attaquant s'il est encore en jeu).
  const attacker = nextInGame(s, s.attacker, s.step);
  s.attacker = attacker;
  s.defender = nextInGame(s, attacker, s.step === 1 ? -1 : 1);
  s.round += 1;
  s.phase = 'attack';
  beginRound(s);
}

function removeFromHand(s: GameState, p: number, card: Card): boolean {
  const hand = s.players[p].hand;
  const i = hand.findIndex((c) => sameCard(c, card));
  if (i < 0) return false;
  hand.splice(i, 1);
  return true;
}

function recordAttack(s: GameState, card: Card) {
  const id = cardId(card);
  const prev = s.attackStreaks[id];
  s.attackStreaks[id] =
    prev && prev.round === s.round - 1 ? { round: s.round, count: prev.count + 1 } : { round: s.round, count: 1 };
}

/**
 * Applique l'action d'un joueur. L'état d'entrée n'est jamais modifié.
 */
export function applyAction(state: GameState, player: number, action: Action): ActionResult {
  if (state.phase === 'finished') return { ok: false, error: 'La partie est terminée.' };
  if (player !== state.actor) return { ok: false, error: "Ce n'est pas à toi de jouer." };
  const s = structuredClone(state);
  const has = (c: Card) => s.players[player].hand.some((h) => sameCard(h, c));

  switch (action.type) {
    case 'chooseAttacker': {
      if (s.phase !== 'chooseAttacker') return { ok: false, error: "L'attaquant est déjà choisi." };
      if (!neighbours(s, s.defender).includes(action.target) || action.target === s.defender)
        return { ok: false, error: "L'attaquant doit être un de tes voisins." };
      setAttacker(s, action.target);
      return { ok: true, state: s };
    }

    case 'attack': {
      if (s.phase !== 'attack') return { ok: false, error: "Ce n'est pas le moment d'attaquer." };
      if (!has(action.card)) return { ok: false, error: "Tu n'as pas cette carte." };
      if (isAttackBlocked(s, action.card))
        return { ok: false, error: 'Cette carte a déjà été posée en attaque sur 2 plis de suite.' };
      if (!attackOptions(s, player).some((c) => sameCard(c, action.card)))
        return { ok: false, error: 'Tu ne peux relancer qu’avec la valeur d’une des deux dernières cartes posées.' };
      const relance = s.table.length > 0;
      removeFromHand(s, player, action.card);
      recordAttack(s, action.card);
      s.table.push({ attack: action.card, defense: null, by: player });
      s.log.push({ t: 'attack', p: player, card: action.card, relance });
      s.phase = 'defend';
      s.actor = s.defender;
      return { ok: true, state: s };
    }

    case 'defend': {
      if (s.phase !== 'defend') return { ok: false, error: "Il n'y a rien à battre." };
      if (!has(action.card)) return { ok: false, error: "Tu n'as pas cette carte." };
      const pair = s.table[s.table.length - 1];
      if (!beats(pair.attack, action.card, s.trumpSuit))
        return { ok: false, error: 'Cette carte ne bat pas la carte attaquante.' };
      removeFromHand(s, player, action.card);
      pair.defense = action.card;
      s.log.push({ t: 'defend', p: player, card: action.card, on: pair.attack });
      nextRelance(s);
      return { ok: true, state: s };
    }

    case 'take': {
      if (s.phase !== 'defend') return { ok: false, error: "Il n'y a rien à ramasser." };
      endRound(s, false);
      return { ok: true, state: s };
    }

    case 'pass': {
      if (s.phase !== 'attack' || s.table.length === 0)
        return { ok: false, error: "Tu dois ouvrir l'attaque avec une carte." };
      s.passed.push(player);
      s.log.push({ t: 'pass', p: player });
      nextRelance(s);
      return { ok: true, state: s };
    }

    default:
      return { ok: false, error: 'Action inconnue.' };
  }
}

/** Reconstruit une action propre à partir d'une entrée non fiable (réseau). */
export function sanitizeAction(input: unknown): Action | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as Record<string, unknown>;
  const card = (): Card | null => {
    const c = a.card as Record<string, unknown> | undefined;
    if (!c || typeof c !== 'object') return null;
    const r = Number(c.r) as Rank;
    const suit = String(c.s) as Suit;
    return RANKS.includes(r) && SUITS.includes(suit) ? { r, s: suit } : null;
  };
  switch (a.type) {
    case 'take':
    case 'pass':
      return { type: a.type };
    case 'chooseAttacker':
      return Number.isInteger(a.target) ? { type: 'chooseAttacker', target: a.target as number } : null;
    case 'attack':
    case 'defend': {
      const c = card();
      return c ? { type: a.type, card: c } : null;
    }
    default:
      return null;
  }
}

/** Action jouée automatiquement quand le temps du joueur est écoulé. */
export function timeoutAction(s: GameState): Action | null {
  switch (s.phase) {
    case 'chooseAttacker':
      return { type: 'chooseAttacker', target: neighbours(s, s.defender)[0] };
    case 'defend':
      return { type: 'take' };
    case 'attack': {
      if (s.table.length > 0) return { type: 'pass' };
      const opts = attackOptions(s, s.actor);
      const weakest = opts.slice().sort((a, b) => Number(a.s === s.trumpSuit) - Number(b.s === s.trumpSuit) || a.r - b.r)[0];
      return weakest ? { type: 'attack', card: weakest } : null;
    }
    default:
      return null;
  }
}
