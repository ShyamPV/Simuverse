import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PC, angleBetween, apparentMagnitude, eclipticToEquatorial, sphericalToCartesian, DEG } from '@simuverse/astro';
import { decodeStarCatalog, starDisplayName } from './starCatalog.ts';

const bin = fileURLToPath(new URL('../../../apps/web/public/data/stars-hyg.bin', import.meta.url));

describe('decodeStarCatalog', () => {
  const file = readFileSync(bin);
  const stars = decodeStarCatalog(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

  it('decodes the full catalogue sorted brightest first', () => {
    expect(stars.count).toBeGreaterThan(100_000);
    const mag = (i: number) => {
      const p = stars.positions;
      return apparentMagnitude(stars.absMag[i]!, Math.hypot(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!));
    };
    expect(mag(0)).toBeCloseTo(-1.44, 1); // Sirius
    expect(mag(0)).toBeLessThan(mag(100));
    expect(mag(100)).toBeLessThan(mag(10_000));
  });

  it('puts Sirius at its ICRS position and distance', () => {
    const p = stars.positions;
    const eq = eclipticToEquatorial([p[0]!, p[1]!, p[2]!]);
    const ref = sphericalToCartesian(101.2872 * DEG, -16.7161 * DEG);
    expect(angleBetween(eq, ref) / DEG).toBeLessThan(0.01);
    expect(Math.hypot(...eq)).toBeCloseTo(2.64, 1);
    expect(PC).toBeGreaterThan(0);
  });

  it('assigns blue-white to Sirius and orange to Arcturus', () => {
    const c = stars.colors;
    expect(c[0 * 3 + 2]).toBe(1); // Sirius: blue channel dominates
    expect(c[2 * 3]).toBe(1); // Arcturus: red channel dominates
    expect(c[2 * 3 + 2]!).toBeLessThan(0.7);
  });
});

describe('starDisplayName', () => {
  it('prefers proper names, then Bayer, then Flamsteed', () => {
    expect(starDisplayName({ i: 0, name: 'Vega', bayer: 'Alp', con: 'Lyr' })).toBe('Vega');
    expect(starDisplayName({ i: 0, bayer: 'Alp-1', con: 'Cen' })).toBe('α¹ Cen');
    expect(starDisplayName({ i: 0, flam: 61, con: 'Cyg' })).toBe('61 Cyg');
    expect(starDisplayName({ i: 0 })).toBeUndefined();
  });
});
