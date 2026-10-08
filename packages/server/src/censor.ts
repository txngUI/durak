/**
 * Filtre de vulgarité pour le chat et les pseudos.
 * Chaque mot est normalisé (minuscules, sans accents, leet speak, lettres répétées réduites)
 * puis comparé à une liste : les mots trouvés sont remplacés par des astérisques.
 */

/** Mots interdits seuls (trop courts ou trop ambigus pour servir de préfixe). */
const EXACT = [
  'con', 'cons', 'cone', 'cones', 'conard', 'conards', 'cul', 'culs', 'pd', 'pds', 'pede', 'pedes', 'fdp', 'tg', 'ntm',
  'nntm', 'vtff', 'tafiole', 'garce', 'garces', 'pute', 'putes', 'bite', 'bites', 'zob', 'teub', 'chatte', 'fion',
  'gueule', 'ass', 'fag', 'fags', 'cock', 'cocks', 'twat', 'wanker', 'tits', 'kys',
];

/** Racines interdites : tout mot qui commence ainsi est censuré. */
const STEMS = [
  'connard', 'conas', 'conass', 'encul', 'salop', 'salaud', 'putain', 'putin', 'batard', 'niquer', 'niquez', 'nique',
  'niktamer', 'enfoir', 'merde', 'merdi', 'chier', 'couill', 'branl', 'pouffias', 'poufias', 'trouduc', 'tapette',
  'gouine', 'bougnoul', 'youpin', 'negre', 'bamboula', 'pedale', 'pedophil', 'grognass', 'connass', 'abrut', 'debil',
  'fuck', 'fuk', 'shit', 'bitch', 'cunt', 'dick', 'asshole', 'bastard', 'slut', 'whore', 'nigg', 'nigga', 'faggot',
  'retard', 'motherf', 'pussy', 'penis', 'vagin', 'sodomi', 'porn',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '€': 'e' };

const collapse = (w: string) => w.replace(/(.)\1+/g, '$1');

export function normalizeWord(word: string): string {
  const base = word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[013457@$€]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '');
  return collapse(base);
}

const EXACT_SET = new Set(EXACT.map(collapse));
const STEMS_N = STEMS.map(collapse);

export function isVulgar(word: string): boolean {
  const n = normalizeWord(word);
  if (!n) return false;
  return EXACT_SET.has(n) || STEMS_N.some((s) => n.startsWith(s));
}

/** Les « mots » incluent chiffres et symboles de leet speak, pour attraper « c0nn4rd ». */
const WORD = /[\p{L}0-9@$€]+/gu;

export function censor(text: string): string {
  let out = text.replace(WORD, (w) => (isVulgar(w) ? '*'.repeat([...w].length) : w));
  // Mots coupés par des espaces ou des points (« p u t e », « c.o.n.n.a.r.d ») : on recolle et on vérifie.
  out = out.replace(/(?:\p{L}[\s.\-_*]){2,}\p{L}/gu, (m) => {
    const glued = m.replace(/[\s.\-_*]/g, '');
    return isVulgar(glued) ? '*'.repeat([...m].length) : m;
  });
  return out;
}

export function containsVulgarity(text: string): boolean {
  return censor(text) !== text;
}
