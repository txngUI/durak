/** C trèfle, D carreau, H cœur, S pique ; à 5-6 joueurs : L lys (noir), E étoile (rouge). */
export type Suit = 'C' | 'D' | 'H' | 'S' | 'L' | 'E';
export type Rank = 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  r: Rank;
  s: Suit;
}

/** Les 4 couleurs classiques (jeu de 36 cartes). */
export const BASE_SUITS: Suit[] = ['C', 'D', 'H', 'S'];
/** Couleurs ajoutées à 5 ou 6 joueurs (jeu de 54 cartes). */
export const EXTRA_SUITS: Suit[] = ['L', 'E'];
/** Toutes les couleurs possibles. */
export const SUITS: Suit[] = [...BASE_SUITS, ...EXTRA_SUITS];
/** À partir de ce nombre de joueurs, on joue avec les deux couleurs supplémentaires. */
export const EXTRA_SUITS_FROM_PLAYERS = 5;
export const RANKS: Rank[] = [6, 7, 8, 9, 10, 11, 12, 13, 14];

// \uFE0E : affichage en texte (sinon certains téléphones dessinent un émoji coloré).
export const SUIT_SYMBOL: Record<Suit, string> = { C: '♣', D: '♦', H: '♥', S: '♠', L: '⚜\uFE0E', E: '★' };
export const SUIT_NAME: Record<Suit, string> = {
  C: 'trèfle',
  D: 'carreau',
  H: 'cœur',
  S: 'pique',
  L: 'lys',
  E: 'étoile',
};
const RANK_LABEL: Record<Rank, string> = {
  6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export const rankLabel = (r: Rank) => RANK_LABEL[r];
export const isRed = (s: Suit) => s === 'D' || s === 'H' || s === 'E';

/** Identifiant stable d'une carte, ex. "12H" pour la dame de cœur. */
export const cardId = (c: Card) => `${c.r}${c.s}`;

export function parseCard(id: string): Card {
  const s = id.slice(-1) as Suit;
  const r = Number(id.slice(0, -1)) as Rank;
  if (!SUITS.includes(s) || !RANKS.includes(r)) throw new Error(`Carte invalide : ${id}`);
  return { r, s };
}

export const cardLabel = (c: Card) => `${rankLabel(c.r)}${SUIT_SYMBOL[c.s]}`;
export const sameCard = (a: Card, b: Card) => a.r === b.r && a.s === b.s;

/**
 * La carte de défense bat-elle la carte d'attaque ?
 * Même couleur et rang supérieur, ou atout sur non-atout.
 * Atout sur atout : rang supérieur uniquement (couvert par le premier cas).
 */
export function beats(attack: Card, defense: Card, trump: Suit): boolean {
  if (defense.s === attack.s) return defense.r > attack.r;
  return defense.s === trump;
}

/** Jeu de 36 cartes, ou de 54 avec les couleurs lys et étoile. */
export function fullDeck(extraSuits = false): Card[] {
  return (extraSuits ? SUITS : BASE_SUITS).flatMap((s) => RANKS.map((r) => ({ r, s })));
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Tri par couleur : trèfle, carreau, cœur, pique, l'atout regroupé à droite ; du 6 à l'As dans chaque couleur. */
export function sortHandBySuit(hand: Card[], trump: Suit): Card[] {
  const order = (s: Suit) => (s === trump ? 9 : SUITS.indexOf(s));
  return hand.slice().sort((a, b) => order(a.s) - order(b.s) || a.r - b.r);
}

/** Tri d'affichage d'une main : du 6 à l'As ; à valeur égale, l'atout en dernier. */
export function sortHand(hand: Card[], trump: Suit): Card[] {
  const order = (s: Suit) => (s === trump ? 9 : SUITS.indexOf(s));
  return hand.slice().sort((a, b) => a.r - b.r || order(a.s) - order(b.s));
}
