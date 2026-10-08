import type { ReactNode } from 'react';
import { type Card, type LogEntry, type PlayerView, SUIT_NAME, SUIT_SYMBOL, cardLabel, rankLabel } from '@durak/engine';

/** Couleurs d'avatar [fond, texte], bien distinctes entre elles sur le tapis. */
export const AVATAR_COLORS = [
  ['#d8ae55', '#2a1d05'],
  ['#6fa8a6', '#082022'],
  ['#c9463c', '#ffffff'],
  ['#4f6fd0', '#ffffff'],
  ['#9b6fc9', '#ffffff'],
  ['#5f9a4c', '#ffffff'],
  ['#e0864a', '#2a1405'],
  ['#d46a9f', '#ffffff'],
];
export const COLOR_NAMES = ['Or', 'Sarcelle', 'Rouge', 'Bleu', 'Violet', 'Vert', 'Orange', 'Rose'];

/** Couleur d'avatar choisie par le joueur. */
export const avatarColors = (color: number) => AVATAR_COLORS[((color % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length];
export const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

export function logText(e: LogEntry, name: (p: number) => string): { who?: string; text: string; tone?: 'red' } {
  switch (e.t) {
    case 'start':
      return {
        text: `Atout ${SUIT_SYMBOL[e.trump.s]} (${cardLabel(e.trump)}). ${name(e.defender)} défend en premier${
          e.reason === 'durak' ? ' (durak de la dernière partie)' : e.reason === 'lowestTrump' ? ' (atout le plus faible)' : ''
        }.`,
      };
    case 'chooseAttacker':
      return { who: name(e.defender), text: `choisit ${name(e.attacker)} comme attaquant` };
    case 'attack':
      return { who: name(e.p), text: `${e.relance ? 'relance' : 'attaque'} ${cardLabel(e.card)}` };
    case 'defend':
      return { who: name(e.p), text: `bat avec ${cardLabel(e.card)}` };
    case 'pass':
      return { who: name(e.p), text: 'passe' };
    case 'take':
      return { who: name(e.p), text: `ramasse ${e.count} carte${e.count > 1 ? 's' : ''}`, tone: 'red' };
    case 'discard':
      return { text: `${e.count} cartes à la défausse` };
    case 'noAttack':
      return { who: name(e.p), text: 'ne peut pas ouvrir (règle des 3 poses)' };
    case 'out':
      return { who: name(e.p), text: 'n’a plus de cartes : sorti !' };
    case 'end':
      return { text: `${name(e.durak ?? -1)} est le durak.`, tone: 'red' };
  }
}

/** Consigne affichée au-dessus des boutons. */
export function promptFor(v: PlayerView, name: (p: number) => string): { node: ReactNode; yours: boolean } {
  const you = v.you;
  const yours = v.actor === you;
  const last = v.table[v.table.length - 1];
  if (v.phase === 'finished') return { node: 'Partie terminée.', yours: false };
  const place = v.players[you]?.place ?? null;
  if (place === 0) return { node: <>♛ <b>Tu es le Korol !</b> Profite de la fin de la partie.</>, yours: false };
  if (place !== null) return { node: `Tu as fini ${place + 1}e : tu regardes la fin de la partie.`, yours: false };

  switch (v.phase) {
    case 'chooseAttacker':
      return { node: yours ? 'Choisis lequel de tes voisins t’attaque.' : `${name(v.defender)} choisit son attaquant…`, yours };
    case 'defend': {
      if (!yours) return { node: `${name(v.defender)} doit battre ${cardLabel(last.attack)}…`, yours };
      const a = last.attack;
      const how =
        a.s === v.trumpSuit
          ? `un atout ${SUIT_SYMBOL[v.trumpSuit]} plus fort`
          : `un ${SUIT_NAME[a.s]} plus fort ou un atout ${SUIT_SYMBOL[v.trumpSuit]}`;
      return {
        node: v.legal.defend.length ? (
          <>Bats le <b>{cardLabel(a)}</b> : {how}.</>
        ) : (
          <>Tu ne peux pas battre le <b>{cardLabel(a)}</b> : ramasse.</>
        ),
        yours,
      };
    }
    case 'attack': {
      const opening = v.table.length === 0;
      if (!yours) {
        return {
          node: opening ? `${name(v.actor)} ouvre l’attaque contre ${name(v.defender)}…` : `${name(v.actor)} peut relancer…`,
          yours,
        };
      }
      if (opening) return { node: <>À toi d’attaquer <b>{name(v.defender)}</b> : pose n’importe quelle carte.</>, yours };
      const ranks = (v.relanceRanks ?? []).map(rankLabel);
      return {
        node: (
          <>
            {name(v.defender)} a battu. Relance avec un <b>{ranks[0]}</b>
            {ranks[1] && <> ou un <b>{ranks[1]}</b></>}, ou passe.
          </>
        ),
        yours,
      };
    }
  }
}

export const sameCard = (a: Card, b: Card | null | undefined) => !!b && a.r === b.r && a.s === b.s;
export const cardKey = (c: Card) => `${c.r}${c.s}`;
