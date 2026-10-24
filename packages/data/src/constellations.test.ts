import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Constellations, constellationAt } from './constellations.ts';

const data = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../apps/web/public/data/constellations.json', import.meta.url)), 'utf8'),
) as Constellations;

describe('constellationAt', () => {
  it.each([
    ['Betelgeuse', 88.793, 7.407, 'Ori'],
    ['Sirius', 101.287, -16.716, 'CMa'],
    ['Polaris', 37.955, 89.264, 'UMi'],
    ['south celestial pole', 0, -89.9, 'Oct'],
    ['Alpheratz (RA ≈ 0)', 2.097, 29.09, 'And'],
    ['Galactic centre', 266.405, -28.936, 'Sgr'],
    ['Acrux', 186.65, -63.1, 'Cru'],
  ])('%s is in %s', (_name, ra, dec, expected) => {
    expect(constellationAt(data, ra, dec)).toBe(expected);
  });
});
