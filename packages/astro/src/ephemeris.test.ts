import { describe, expect, it } from 'vitest';
import fx from './__fixtures__/horizons-observer.json' with { type: 'json' };
import { EphemerisStore, evaluateSeries, type ChebyshevSeries } from './chebyshev.ts';
import { EQUATORIAL_TO_ECLIPTIC } from './coords.ts';
import { AU_KM, Ephemeris, type SolarBodyId } from './ephemeris.ts';
import { loadTestEphemeris } from './testing.ts';
import { type Vec3, length, mulMat3Vec, sub } from './vec.ts';

describe('Chebyshev evaluation', () => {
  it('reproduces known polynomials through Clenshaw summation', () => {
    // x(u) = 3 + 2u + (2u²−1)·0.5 on one 10-day segment; y = T3, z = 0
    const s: ChebyshevSeries = {
      id: 'test', segmentDays: 10, degree: 3, firstJd: 100, segmentCount: 1,
      coeffs: Float32Array.from([3, 2, 0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0]),
    };
    const out: Vec3 = [0, 0, 0];
    for (const u of [-1, -0.3, 0, 0.71, 1]) {
      expect(evaluateSeries(s, 100 + (u + 1) * 5, out)).toBe(true);
      expect(out[0]).toBeCloseTo(3 + 2 * u + 0.5 * (2 * u * u - 1), 6);
      expect(out[1]).toBeCloseTo(4 * u ** 3 - 3 * u, 6);
    }
    expect(evaluateSeries(s, 99.9, out)).toBe(false);
    expect(evaluateSeries(s, 110.1, out)).toBe(false);
  });
});

/** Fit tolerance in km per body: DE440 fit + float32 rounding, see tools/build-ephemeris.mjs. */
const MAX_ERR_KM: Record<string, number> = {
  sun: 1, mercury: 10, venus: 10, earth: 15, mars: 15, jupiter: 400, saturn: 400,
  uranus: 600, neptune: 800, pluto: 3000, moon: 0.1,
};

describe('DE440 Chebyshev ephemeris vs JPL Horizons (off-grid epochs)', () => {
  const eph = loadTestEphemeris();
  for (const [id, rows] of Object.entries(fx.validation)) {
    it(`${id} within ${MAX_ERR_KM[id]} km`, () => {
      for (const { jdTdb, r } of rows) {
        const ref = mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, r as Vec3);
        const p: Vec3 = [0, 0, 0];
        expect(eph.relative(id as SolarBodyId, jdTdb, p)).toBe(true);
        expect(length(sub(p, ref))).toBeLessThan(MAX_ERR_KM[id]!);
      }
    });
  }
});

describe('fallback models', () => {
  const eph = new Ephemeris(new EphemerisStore());
  it('reports imprecise results but stays close outside the DE440 span', () => {
    const p: Vec3 = [0, 0, 0];
    expect(eph.relative('mars', 2451545, p)).toBe(false);
    expect(length(p) / AU_KM).toBeGreaterThan(1.3);
    expect(length(p) / AU_KM).toBeLessThan(1.7);
    expect(eph.relative('sun', 2451545, p)).toBe(false);
    expect(p).toEqual([0, 0, 0]);
  });
});
