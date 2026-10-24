import { describe, expect, it } from 'vitest';
import { SearchIndex, normalizeName } from './search.ts';

const index = new SearchIndex();
index.add([
  { key: 'body:jupiter', ref: 'jupiter', name: 'Jupiter', kind: 'body', rank: 0 },
  { key: 'body:io', ref: 'io', name: 'Io', kind: 'moon', rank: 5 },
  { key: 'gal:2', ref: 'Andromeda Galaxy', name: 'Andromeda Galaxy', aliases: ['M31', 'NGC 224'], kind: 'galaxy', rank: 3 },
  { key: 'con:And', ref: 'Andromeda', name: 'Andromeda', kind: 'constellation', rank: 20 },
  { key: 'star:3', ref: 'HIP 71683', name: 'Rigil Kentaurus', aliases: ['α¹ Cen', 'Alpha Centauri'], kind: 'star', rank: 2 },
  { key: 'dso:0', ref: 'NGC 1952', name: 'Crab Nebula', aliases: ['M1', 'NGC 1952'], kind: 'nebula', rank: 10 },
  { key: 'dso:9', ref: 'NGC 6611', name: 'Eagle Nebula', aliases: ['M16'], kind: 'nebula', rank: 12 },
  { key: 'exo:7', ref: 'TRAPPIST-1', name: 'TRAPPIST-1', kind: 'system', rank: 30 },
  { key: 'exop:7:4', ref: 'TRAPPIST-1 e', name: 'TRAPPIST-1 e', kind: 'exoplanet', rank: 35 },
]);

describe('search', () => {
  it('normalises case, accents, spacing and Greek letters', () => {
    expect(normalizeName('  Alpha  Centauri ')).toBe('alpha centauri');
    expect(normalizeName('Bode’s Galaxy')).toBe('bode s galaxy');
    expect(normalizeName('α¹ Cen')).toBe('alpha 1 cen');
    expect(normalizeName('Barnard’s Star (Gliese 699)')).toBe('barnard s star gliese 699');
  });

  it('matches catalogue designations regardless of spacing', () => {
    for (const q of ['m31', 'M 31', 'ngc224', 'NGC 224']) expect(index.search(q)[0]!.entry.key).toBe('gal:2');
    expect(index.search('m1')[0]!.entry.key).toBe('dso:0');
  });

  it('prefers exact matches, then prefixes, then prominence', () => {
    const hits = index.search('andromeda');
    expect(hits.map((h) => h.entry.key).slice(0, 2)).toEqual(['con:And', 'gal:2']);
    expect(index.search('andro')[0]!.entry.key).toBe('gal:2'); // equal prefixes: the more prominent wins
    expect(index.search('jup')[0]!.entry.name).toBe('Jupiter');
  });

  it('finds stars by Greek-letter names and words in any order', () => {
    expect(index.search('alpha cen')[0]!.entry.key).toBe('star:3');
    expect(index.search('α¹ Cen')[0]!.entry.key).toBe('star:3');
    expect(index.search('nebula eagle')[0]!.entry.key).toBe('dso:9');
  });

  it('resolves stable references for shared links', () => {
    expect(index.resolve('HIP 71683')?.key).toBe('star:3');
    expect(index.resolve('trappist-1 e')?.key).toBe('exop:7:4');
    expect(index.resolve('M31')?.key).toBe('gal:2');
    expect(index.resolve('no such thing')).toBeUndefined();
  });
});
