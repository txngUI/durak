import { describe, expect, it } from 'vitest';
import { censor, containsVulgarity } from '../src/censor';

describe('filtre de vulgarité', () => {
  it('censure les insultes, même déguisées', () => {
    expect(censor('espèce de connard')).toBe('espèce de *******');
    expect(censor('CONNNNARD')).toBe('*********');
    expect(censor('c0nn4rd')).toBe('*******');
    expect(censor('fdp va')).toBe('*** va');
    expect(censor('p u t e')).toBe('*******');
    expect(censor('Putain, encore ramassé')).toBe('******, encore ramassé');
    expect(censor('what the fuck')).toBe('what the ****');
    expect(censor('enculé')).toBe('******');
  });

  it('laisse passer les mots normaux', () => {
    for (const ok of [
      'bien joué',
      'content de jouer',
      'la culture',
      'le pédestre',
      'composer une main',
      'je contre avec le roi',
      'bitume',
      'gg wp',
      'Léa défend',
      'atout cœur',
      'à la défausse',
    ]) {
      expect(censor(ok)).toBe(ok);
    }
  });

  it('détecte une vulgarité dans un pseudo', () => {
    expect(containsVulgarity('SalopeDu93')).toBe(true);
    expect(containsVulgarity('Tanguy')).toBe(false);
  });
});
