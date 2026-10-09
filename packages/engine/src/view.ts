import { type Card, type Rank, type Suit, sortHand } from './cards';
import {
  type GameState,
  type LastRound,
  type LogEntry,
  type Phase,
  type TablePair,
  MAX_ATTACKS,
  attackOptions,
  defenseOptions,
  isAttackBlocked,
  neighbours,
  relanceRanks,
} from './game';

export interface PlayerSummary {
  id: string;
  name: string;
  cardCount: number;
  place: number | null;
}

/** Ce qu'un joueur a le droit de voir : sa main, jamais celle des autres. */
export interface PlayerView {
  you: number;
  players: PlayerSummary[];
  hand: Card[];
  /** Cartes de ta main interdites en attaque à ce pli (règle des 3 poses d'affilée). */
  blocked: Card[];
  trumpCard: Card;
  trumpSuit: Suit;
  /** La carte d'atout est-elle encore sous le talon ? */
  trumpInDeck: boolean;
  deckCount: number;
  discardCount: number;
  phase: Phase;
  round: number;
  attacker: number;
  defender: number;
  actor: number;
  table: TablePair[];
  maxAttacks: number;
  relanceRanks: Rank[] | null;
  legal: {
    attack: Card[];
    defend: Card[];
    canTake: boolean;
    canPass: boolean;
    chooseTargets: number[];
  };
  /** Partie à 54 cartes, avec le lys et l'étoile. */
  extraSuits: boolean;
  /** Dernier pli terminé (cartes jouées et issue), affiché brièvement par l'interface. */
  lastRound: LastRound | null;
  durak: number | null;
  log: LogEntry[];
  /** Nombre total d'entrées du journal (le journal envoyé n'en contient que les dernières). */
  logSize: number;
}

export function viewFor(s: GameState, you: number): PlayerView {
  const isActor = s.actor === you;
  const trumpInDeck = s.deck.length > 0;
  return {
    you,
    players: s.players.map((p) => ({ id: p.id, name: p.name, cardCount: p.hand.length, place: p.place })),
    hand: you >= 0 ? sortHand(s.players[you].hand, s.trumpSuit) : [],
    blocked: you >= 0 ? s.players[you].hand.filter((c) => isAttackBlocked(s, c)) : [],
    trumpCard: s.trumpCard,
    trumpSuit: s.trumpSuit,
    trumpInDeck,
    deckCount: s.deck.length,
    discardCount: s.discardCount,
    phase: s.phase,
    round: s.round,
    attacker: s.attacker,
    defender: s.defender,
    actor: s.actor,
    table: s.table,
    maxAttacks: MAX_ATTACKS,
    relanceRanks: relanceRanks(s),
    legal: {
      attack: isActor ? attackOptions(s, you) : [],
      defend: isActor ? defenseOptions(s) : [],
      canTake: isActor && s.phase === 'defend',
      canPass: isActor && s.phase === 'attack' && s.table.length > 0,
      chooseTargets: isActor && s.phase === 'chooseAttacker' ? neighbours(s, s.defender) : [],
    },
    extraSuits: !!s.extraSuits,
    lastRound: s.lastRound,
    durak: s.durak,
    log: s.log.slice(-40),
    logSize: s.log.length,
  };
}
