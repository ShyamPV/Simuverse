import { describe, expect, it } from 'vitest';
import fixtures from './__fixtures__/horizons-moons.json' with { type: 'json' };
import { EQUATORIAL_TO_ECLIPTIC } from './coords.ts';
import { MOONS, moonMagnitude, moonPeriodDays, moonPosition, moonRecord } from './moons.ts';
import { DEG } from './units.ts';
import { type Vec3, mulMat3Vec } from './vec.ts';

describe('fitted moon orbits', () => {
  it('has the 21 major moons with physical data', () => {
    expect(MOONS.map((m) => m.id)).toContain('titan');
    expect(MOONS).toHaveLength(21);
    expect(MOONS.find((m) => m.id === 'ganymede')!.mass).toBeCloseTo(1.4819e23, -20);
  });

  it('matches JPL Horizons positions to within the fit tolerance (1950–2050)', () => {
    for (const f of fixtures) {
      const rec = moonRecord(f.id)!;
      const want = mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, f.icrfKm as Vec3);
      const got = moonPosition(f.id, f.jdTdb);
      const errDeg = Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]) / rec.el.a / DEG;
      // Along-orbit error, as seen from the planet: a few times the fit RMS, and never more than 2°.
      expect(errDeg, `${f.id} @ JD ${f.jdTdb}`).toBeLessThan(Math.min(Math.max(4 * rec.fitRmsDeg, 0.1), 2));
    }
  });

  it('has the right periods', () => {
    expect(moonPeriodDays('io')).toBeCloseTo(1.769, 2);
    expect(moonPeriodDays('titan')).toBeCloseTo(15.945, 2);
    expect(moonPeriodDays('triton')).toBeCloseTo(5.877, 2);
  });

  it('gives plausible magnitudes at opposition', () => {
    // Galilean moons at Jupiter's opposition (r ≈ 5.2 AU, Δ ≈ 4.2 AU): Io ~5.0, Callisto ~5.7.
    expect(moonMagnitude('io', 5.2, 4.2, 0)).toBeCloseTo(5.0, 0);
    expect(moonMagnitude('callisto', 5.2, 4.2, 0)).toBeCloseTo(5.7, 0);
    expect(moonMagnitude('titan', 9.5, 8.5, 0)).toBeCloseTo(8.3, 0);
  });
});
