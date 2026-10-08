import { describe, expect, it } from 'vitest';
import { beats, cardId, createRng, sortHand, sortHandBySuit } from '../src/cards';
import {
  type Action,
  type GameState,
  applyAction,
  attackOptions,
  createGame,
  defenseOptions,
  isAttackBlocked,
  timeoutAction,
} from '../src/game';
import { viewFor } from '../src/view';
import { atk, c, cs, def, pass, play, setup, take } from './helpers';

const names = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const ids = (cards: { r: number; s: string }[]) => cards.map((x) => `${x.r}${x.s}`).sort();

describe('mise en place', () => {
  it('distribue 6 cartes à chacun et place l’atout sous le talon', () => {
    const g = createGame(names(4), { seed: 1 });
    expect(g.players.map((p) => p.hand.length)).toEqual([6, 6, 6, 6]);
    expect(g.deck).toHaveLength(12);
    expect(g.deck[0]).toEqual(g.trumpCard);
    expect(g.trumpSuit).toBe(g.trumpCard.s);
    const all = [...g.players.flatMap((p) => p.hand), ...g.deck].map(cardId);
    expect(new Set(all).size).toBe(36);
  });

  it('à 6 joueurs, la dernière carte distribuée donne l’atout', () => {
    const g = createGame(names(6), { seed: 3 });
    expect(g.deck).toHaveLength(0);
    expect(g.players[5].hand).toContainEqual(g.trumpCard);
  });

  it('le joueur avec l’atout le plus faible défend en premier', () => {
    for (let seed = 1; seed < 40; seed++) {
      const g = createGame(names(4), { seed });
      const trumps = g.players.flatMap((p, i) => p.hand.filter((x) => x.s === g.trumpSuit).map((x) => ({ i, r: x.r })));
      if (trumps.length === 0) continue;
      const lowest = trumps.sort((a, b) => a.r - b.r)[0];
      expect(g.defender).toBe(lowest.i);
    }
  });

  it('le durak de la partie précédente défend en premier', () => {
    const g = createGame(names(4), { seed: 1, previousDurakId: 'p2' });
    expect(g.defender).toBe(2);
    expect(g.log[0]).toMatchObject({ t: 'start', reason: 'durak' });
  });

  it('le premier défenseur choisit un de ses deux voisins comme attaquant', () => {
    const g = createGame(names(4), { seed: 1, previousDurakId: 'p0' });
    expect(g.phase).toBe('chooseAttacker');
    expect(g.actor).toBe(0);
    expect(applyAction(g, 0, { type: 'chooseAttacker', target: 2 }).ok).toBe(false);
    expect(applyAction(g, 1, { type: 'chooseAttacker', target: 1 }).ok).toBe(false);
    const r = applyAction(g, 0, { type: 'chooseAttacker', target: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.attacker).toBe(3);
    expect(r.state.step).toBe(-1);
    expect(r.state.actor).toBe(3);
  });

  it('à 2 joueurs, l’attaquant est désigné automatiquement', () => {
    const g = createGame(names(2), { seed: 5 });
    expect(g.phase).toBe('attack');
    expect(g.attacker).toBe(1 - g.defender);
  });
});

describe('défense', () => {
  it('bat avec une carte plus forte de même couleur ou un atout', () => {
    expect(beats(c('8C'), c('10C'), 'H')).toBe(true);
    expect(beats(c('8C'), c('7C'), 'H')).toBe(false);
    expect(beats(c('AC'), c('6H'), 'H')).toBe(true);
    expect(beats(c('AC'), c('KD'), 'H')).toBe(false);
    expect(beats(c('9H'), c('10H'), 'H')).toBe(true);
    expect(beats(c('9H'), c('7H'), 'H')).toBe(false);
    expect(beats(c('9H'), c('AS'), 'H')).toBe(false);
  });

  it('refuse une carte qui ne bat pas', () => {
    const s = play(setup({ hands: ['9C AS', '8C KD'], trump: 'H', attacker: 1, defender: 0 }), [1, atk('8C')]);
    expect(applyAction(s, 0, def('AS')).ok).toBe(false);
    expect(defenseOptions(s)).toEqual([c('9C')]);
  });
});

describe('relance', () => {
  it('seulement avec la valeur de la dernière attaque ou de sa défense', () => {
    const s0 = setup({ hands: ['10C JS QD AH 8C', '7C 7D 10S JD', '9C'], trump: 'H', attacker: 1, defender: 0 });
    let s = play(s0, [1, atk('7C')], [0, def('10C')]);
    expect(ids(attackOptions(s, 1))).toEqual(ids(cs('7D 10S')));
    s = play(s, [1, atk('10S')], [0, def('JS')]);
    // Le 7 est sur le tapis mais n'est plus une des deux dernières cartes.
    expect(applyAction(s, 1, atk('7D')).ok).toBe(false);
    expect(ids(attackOptions(s, 1))).toEqual(ids(cs('JD')));
    s = play(s, [1, atk('JD')]);
    expect(s.phase).toBe('defend');
  });

  it('les autres joueurs peuvent prendre le relais dans l’ordre de la table', () => {
    const s0 = setup({
      hands: ['7C AS AD KC', '6C AC', 'QH', '7H 6S'],
      trump: 'D',
      attacker: 1,
      defender: 0,
    });
    let s = play(s0, [1, atk('6C')], [0, def('7C')]);
    // P1 et P2 n'ont ni 6 ni 7 : ils passent leur tour, P3 a la main.
    expect(s.actor).toBe(3);
    expect(s.passed).toEqual([1, 2]);
    s = play(s, [3, atk('7H')], [0, def('AD')]);
    // P1 a maintenant un As, mais il a déjà passé son tour : il ne peut plus relancer.
    // P3 n'a ni 7 ni As : le pli se termine.
    expect(s.phase).toBe('attack');
    expect(s.round).toBe(2);
    expect(s.discardCount).toBe(4);
  });

  it('si l’attaquant ne peut pas ouvrir, le joueur suivant attaque le défenseur', () => {
    // P1 n'a que le 8♦, déjà posé en attaque sur les 2 plis précédents : il est bloqué.
    const s0 = setup({ hands: ['AC AD', '8D', '7S KH', '9C'], trump: 'H', attacker: 1, defender: 0, round: 3 });
    s0.attackStreaks['8D'] = { round: 2, count: 2 };
    // Le pli démarre quand le défenseur désigne son attaquant.
    const r = applyAction({ ...s0, phase: 'chooseAttacker', actor: 0, attacker: -1 }, 0, { type: 'chooseAttacker', target: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.attacker).toBe(1);
    expect(r.state.actor).toBe(2);
    expect(r.state.log).toContainEqual({ t: 'noAttack', p: 1 });
    // P2 ouvre contre le défenseur, P0.
    const after = play(r.state, [2, atk('7S')]);
    expect(after.phase).toBe('defend');
    expect(after.actor).toBe(0);
  });

  it('un attaquant qui n’a pas pu relancer ne réattaque plus de ce pli', () => {
    // A ne peut pas relancer (ni 6 ni 7), B relance ; après la défense, A aurait un 8 mais a passé son tour.
    const s0 = setup({ hands: ['7C 9S KD AC', '6C 9C', '7S 9D'], trump: 'H', attacker: 1, defender: 0 });
    let s = play(s0, [1, atk('6C')], [0, def('7C')]);
    expect(s.actor).toBe(2);
    expect(s.passed).toEqual([1]);
    s = play(s, [2, atk('7S')], [0, def('9S')]);
    // Le 9 est désormais relançable : A a le 9♣ mais reste exclu, la main reste à B.
    expect(s.round).toBe(1);
    expect(s.actor).toBe(2);
    expect(applyAction(s, 1, atk('9C')).ok).toBe(false);
  });

  it('un joueur qui a passé ne peut plus relancer pendant ce pli', () => {
    const s0 = setup({ hands: ['7C AS KD 8D AC', '6C 6D 7D', '7S AD'], trump: 'H', attacker: 1, defender: 0 });
    let s = play(s0, [1, atk('6C')], [0, def('7C')]);
    expect(s.actor).toBe(1);
    s = play(s, [1, pass]);
    // B prend le relais, attaque, le défenseur bat.
    expect(s.actor).toBe(2);
    s = play(s, [2, atk('7S')], [0, def('AS')]);
    // A a un 7 mais a passé : la main reste à B.
    expect(s.actor).toBe(2);
    expect(applyAction(s, 1, atk('7D')).ok).toBe(false);
    s = play(s, [2, pass]);
    expect(s.round).toBe(2);
    expect(s.discardCount).toBe(4);
    expect(s.passed).toEqual([]);
  });

  it('le dernier pli reste consultable avec son issue', () => {
    const s0 = setup({ hands: ['8C KD', '7C 9H', 'QS'], trump: 'H', attacker: 1, defender: 0 });
    const s = play(s0, [1, atk('7C')], [0, def('8C')]);
    expect(s.lastRound).toMatchObject({ round: 1, defender: 0, outcome: 'discard' });
    expect(s.lastRound!.table).toEqual([{ attack: c('7C'), defense: c('8C'), by: 1 }]);
  });

  it('le défenseur ne peut pas relancer et on ne passe pas sans attaque', () => {
    const s = setup({ hands: ['7C', '6C'], trump: 'D', attacker: 1, defender: 0 });
    expect(applyAction(s, 0, atk('7C')).ok).toBe(false);
    expect(applyAction(s, 1, pass).ok).toBe(false);
  });
});

describe('résolution du pli', () => {
  it('6 attaques contrées : tout va à la défausse', () => {
    const s0 = setup({
      hands: ['7C 7D 7S 8H 9C 9D AS', '6C 6D 6S 7H 8C 8D 9S'],
      trump: 'H',
      attacker: 1,
      defender: 0,
    });
    const s = play(
      s0,
      [1, atk('6C')], [0, def('7C')],
      [1, atk('6D')], [0, def('7D')],
      [1, atk('6S')], [0, def('7S')],
      [1, atk('7H')], [0, def('8H')],
      [1, atk('8C')], [0, def('9C')],
      [1, atk('8D')], [0, def('9D')],
    );
    expect(s.discardCount).toBe(12);
    expect(s.table).toHaveLength(0);
    expect(s.players[1].hand).toEqual(cs('9S'));
    expect(s.players[0].hand).toEqual(cs('AS'));
  });

  it('le défenseur ramasse toutes les cartes en jeu et ne pioche pas', () => {
    const s0 = setup({
      hands: ['8C KD', '7C 7S 9H', 'QS'],
      deck: '6H JC QC',
      trump: 'H',
      attacker: 1,
      defender: 0,
    });
    const s = play(s0, [1, atk('7C')], [0, def('8C')], [1, atk('7S')], [0, take]);
    expect(ids(s.players[0].hand)).toEqual(ids(cs('KD 7C 8C 7S')));
    // L'attaquant pioche en premier, puis le joueur suivant ; le défenseur jamais.
    expect(ids(s.players[1].hand)).toEqual(ids(cs('9H QC JC 6H')));
    expect(s.players[2].hand).toEqual(cs('QS'));
    expect(s.deck).toHaveLength(0);
  });

  it('retient qui a pioché combien de cartes, dans l’ordre', () => {
    const s0 = setup({ hands: ['8C KD', '7C 9H', 'QS'], deck: '6H JC QC AS 10D 7D 8D 9D 6S', trump: 'H', attacker: 1, defender: 0 });
    const s = play(s0, [1, atk('7C')], [0, def('8C')]);
    // L'attaquant complète à 6, puis P2 prend les 4 dernières ; le défenseur n'a plus rien à piocher.
    expect(s.lastRound!.draws).toEqual([
      { p: 1, n: 5 },
      { p: 2, n: 4 },
    ]);
  });

  it('pioche dans l’ordre attaquant → autres → défenseur', () => {
    const s0 = setup({
      hands: ['AS', '6S 6C'],
      deck: 'KH 7C 8C 9C 10C JC QC',
      trump: 'H',
      attacker: 1,
      defender: 0,
    });
    const s = play(s0, [1, atk('6S')], [0, def('AS')]);
    // Le défenseur n'a plus de carte : le pli s'arrête même si P1 pouvait relancer un 6.
    expect(s.discardCount).toBe(2);
    expect(ids(s.players[1].hand)).toEqual(ids(cs('6C QC JC 10C 9C 8C')));
    expect(ids(s.players[0].hand)).toEqual(ids(cs('7C KH')));
  });
});

describe('règle des 3 poses d’affilée', () => {
  it('une carte posée en attaque sur 2 plis de suite est bloquée au 3e', () => {
    let s = setup({ hands: ['7S 10C QC', '8D 9H KS'], trump: 'H', attacker: 1, defender: 0 });
    s = play(s, [1, atk('8D')], [0, take]);
    expect([s.attacker, s.defender]).toEqual([0, 1]);
    s = play(s, [0, atk('8D')], [1, take]);
    expect([s.attacker, s.defender]).toEqual([1, 0]);
    const r = applyAction(s, 1, atk('8D'));
    expect(r.ok).toBe(false);
    expect(attackOptions(s, 1).map(cardId)).not.toContain('8D');
    s = play(s, [1, atk('9H')], [0, take]);
    // Pli 4 : la série est rompue, le 8♦ n'est plus bloqué.
    expect(s.round).toBe(4);
    expect(isAttackBlocked(s, c('8D'))).toBe(false);
  });
});

describe('tour suivant', () => {
  const four = () =>
    setup({
      hands: ['AC AD AS KC', '6C 6D 7S', '9S 9D 9C', '10S 10D 10C'],
      trump: 'H',
      attacker: 1,
      defender: 0,
    });

  it('le voisin du dernier attaquant, côté opposé au défenseur, attaque le dernier attaquant', () => {
    let s = play(four(), [1, atk('6C')], [0, def('AC')], [1, pass]);
    expect([s.attacker, s.defender]).toEqual([2, 1]);
    s = play(s, [2, atk('9S')], [1, take]);
    // Même après un ramassage, la rotation continue dans le même sens.
    expect([s.attacker, s.defender]).toEqual([3, 2]);
  });

  it('dans l’autre sens quand l’attaquant choisi est à droite', () => {
    let s = setup({ hands: ['AC AD', '8C', '9S', '6D 7S'], trump: 'H', attacker: 3, defender: 0, step: -1 });
    s = play(s, [3, atk('6D')], [0, def('AD')]);
    expect([s.attacker, s.defender]).toEqual([2, 3]);
  });

  it('à 2 joueurs, les rôles s’inversent à chaque pli', () => {
    let s = setup({ hands: ['AC AD KD', '6C 6D 7S'], trump: 'H', attacker: 1, defender: 0 });
    s = play(s, [1, atk('6C')], [0, def('AC')], [1, pass]);
    expect([s.attacker, s.defender]).toEqual([0, 1]);
    s = play(s, [0, atk('KD')], [1, take]);
    expect([s.attacker, s.defender]).toEqual([1, 0]);
  });

  it('saute les joueurs sortis', () => {
    // Talon vide : P1 pose sa dernière carte et sort.
    let s = setup({ hands: ['AC AD', '6C', '9S 9D', '10S 10D'], trump: 'H', attacker: 1, defender: 0 });
    s = play(s, [1, atk('6C')], [0, def('AC')]);
    expect(s.players[1].place).toBe(0);
    expect([s.attacker, s.defender]).toEqual([2, 0]);
  });
});

describe('fin de partie', () => {
  it('le dernier joueur avec des cartes est le durak', () => {
    const s = play(setup({ hands: ['AS KD', '6S'], trump: 'H', attacker: 1, defender: 0 }), [1, atk('6S')], [0, def('AS')]);
    expect(s.phase).toBe('finished');
    expect(s.durak).toBe(0);
    expect(s.players[1].place).toBe(0);
  });

  it('pas d’égalité : si les deux derniers se vident sur le même pli, le défenseur est le durak', () => {
    const s = play(setup({ hands: ['AS', '6S'], trump: 'H', attacker: 1, defender: 0 }), [1, atk('6S')], [0, def('AS')]);
    expect(s.phase).toBe('finished');
    expect(s.durak).toBe(0);
    expect(s.players[1].place).toBe(0);
    expect(s.players[0].place).toBeNull();
  });
});

describe('affichage', () => {
  it('trie la main du 6 à l’As, l’atout en dernier à valeur égale', () => {
    expect(sortHand(cs('AS 7H 10C 7C JD 6S'), 'H')).toEqual(cs('6S 7C 7H 10C JD AS'));
  });

  it('trie aussi par couleur, l’atout regroupé à droite', () => {
    expect(sortHandBySuit(cs('AS 7H 10C 7C JD 6S'), 'H')).toEqual(cs('7C 10C JD 6S AS 7H'));
  });
});

describe('arbitrage', () => {
  it('refuse les actions hors tour et ne modifie jamais l’état reçu', () => {
    const s = setup({ hands: ['AS', '6S 7S'], trump: 'H', attacker: 1, defender: 0 });
    const before = JSON.stringify(s);
    expect(applyAction(s, 0, take).ok).toBe(false);
    expect(applyAction(s, 1, atk('AS')).ok).toBe(false);
    applyAction(s, 1, atk('6S'));
    expect(JSON.stringify(s)).toBe(before);
  });

  it('la vue d’un joueur ne contient pas la main des autres', () => {
    const g = createGame(names(3), { seed: 9 });
    const v = viewFor(g, 1);
    expect(v.hand).toHaveLength(6);
    expect(v.players.map((p) => p.cardCount)).toEqual([6, 6, 6]);
    for (const other of [0, 2]) {
      for (const card of g.players[other].hand) expect(v.hand).not.toContainEqual(card);
    }
  });

  it('au temps écoulé : le défenseur ramasse, la relance passe, l’ouverture pose la plus faible', () => {
    let s = setup({ hands: ['AS', '8H 6S 7C'], trump: 'H', attacker: 1, defender: 0 });
    expect(timeoutAction(s)).toEqual(atk('6S'));
    s = play(s, [1, atk('6S')]);
    expect(timeoutAction(s)).toEqual(take);
    s = play(s, [0, def('AS')]);
  });
});

describe('parties complètes aléatoires', () => {
  it('conserve les 36 cartes et se termine toujours', () => {
    for (let n = 2; n <= 6; n++) {
      for (let seed = 1; seed <= 60; seed++) {
        const rng = createRng(seed * 7 + n);
        let s: GameState = createGame(names(n), { seed });
        let steps = 0;
        while (s.phase !== 'finished') {
          const v = viewFor(s, s.actor);
          const moves: Action[] = [
            ...v.legal.attack.map((card) => ({ type: 'attack', card }) as Action),
            ...v.legal.defend.map((card) => ({ type: 'defend', card }) as Action),
            ...(v.legal.canTake && rng() < 0.3 ? [take] : []),
            ...(v.legal.canPass ? [pass] : []),
            ...v.legal.chooseTargets.map((target) => ({ type: 'chooseAttacker', target }) as Action),
          ];
          if (moves.length === 0) moves.push(take);
          const r = applyAction(s, s.actor, moves[Math.floor(rng() * moves.length)]);
          expect(r.ok).toBe(true);
          if (!r.ok) break;
          s = r.state;
          const total =
            s.players.reduce((a, p) => a + p.hand.length, 0) +
            s.deck.length +
            s.discardCount +
            s.table.reduce((a, t) => a + 1 + (t.defense ? 1 : 0), 0);
          expect(total).toBe(36);
          expect(s.table.length).toBeLessThanOrEqual(6);
          expect(++steps).toBeLessThan(3000);
        }
        expect(s.players.filter((p) => p.place === null)).toHaveLength(1);
        expect(s.durak).not.toBeNull();
      }
    }
  }, 30_000);
});
