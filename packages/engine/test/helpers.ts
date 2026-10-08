import { type Card, type Suit, parseCard } from '../src/cards';
import { type Action, type GameState, applyAction } from '../src/game';

/** "10H" -> carte, "QS" -> dame de pique (J/Q/K/A acceptés). */
export function c(label: string): Card {
  const map: Record<string, string> = { J: '11', Q: '12', K: '13', A: '14' };
  const rank = label.slice(0, -1);
  return parseCard(`${map[rank] ?? rank}${label.slice(-1)}`);
}
export const cs = (labels: string) => labels.split(' ').filter(Boolean).map(c);

interface Setup {
  hands: string[];
  deck?: string; // du dessous (atout) vers le dessus
  trump: Suit;
  attacker: number;
  defender: number;
  step?: 1 | -1;
  round?: number;
}

/** Construit un état en phase d'attaque, attaquant à l'ouverture. */
export function setup(o: Setup): GameState {
  const deck = cs(o.deck ?? '');
  return {
    players: o.hands.map((h, i) => ({ id: `p${i}`, name: `P${i}`, hand: cs(h), place: null })),
    deck,
    trumpCard: deck[0] ?? { r: 6, s: o.trump },
    trumpSuit: o.trump,
    discardCount: 0,
    phase: 'attack',
    round: o.round ?? 1,
    attacker: o.attacker,
    defender: o.defender,
    step: o.step ?? 1,
    actor: o.attacker,
    table: [],
    passed: [],
    attackStreaks: {},
    lastRound: null,
    durak: null,
    log: [],
  };
}

/** Applique une suite d'actions [joueur, action] et échoue au premier refus. */
export function play(s: GameState, ...moves: [number, Action][]): GameState {
  for (const [p, a] of moves) {
    const r = applyAction(s, p, a);
    if (!r.ok) throw new Error(`Coup refusé (${p} ${JSON.stringify(a)}) : ${r.error}`);
    s = r.state;
  }
  return s;
}

export const atk = (l: string): Action => ({ type: 'attack', card: c(l) });
export const def = (l: string): Action => ({ type: 'defend', card: c(l) });
export const take: Action = { type: 'take' };
export const pass: Action = { type: 'pass' };
