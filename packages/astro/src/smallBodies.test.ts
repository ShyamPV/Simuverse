import { describe, expect, it } from 'vitest';
import { asteroidMagnitude, cometMagnitude, smallBodyPeriod, smallBodyPosition } from './smallBodies.ts';
import { DEG } from './units.ts';
import type { Vec3 } from './vec.ts';

// SBDB osculating elements and JPL Horizons heliocentric ecliptic positions at JD 2461337.5 (2026-10-24).
const CASES: { name: string; el: Parameters<typeof smallBodyPosition>[0]; horizons: Vec3; tolAU: number }[] = [
  {
    name: 'Ceres',
    el: { e: 0.07969229514816586, q: 2.545159361382861, i: 10.58802780183462, node: 80.24862682043221, peri: 73.29421453021587, tp: 2461599.841466614 },
    horizons: [0.03876237562870178, 2.654551683352459, 0.0768954571405891],
    tolAU: 0.002,
  },
  {
    name: '1I/ʻOumuamua',
    el: { e: 1.201133796102373, q: 0.2559115812959116, i: 122.7417062847286, node: 24.59690955523242, peri: 241.8105360304898, tp: 2458006.0073213754 },
    horizons: [50.12989924797056, 7.966888405299392, 21.22848497695345],
    tolAU: 0.05,
  },
];

describe('small-body orbits', () => {
  it('propagates elliptic and hyperbolic orbits close to JPL Horizons', () => {
    for (const c of CASES) {
      const p = smallBodyPosition(c.el, 2461337.5);
      const err = Math.hypot(p[0] - c.horizons[0], p[1] - c.horizons[1], p[2] - c.horizons[2]);
      expect(err, c.name).toBeLessThan(c.tolAU);
    }
  });

  it('puts a body at perihelion distance at perihelion time', () => {
    const el = { e: 0.967, q: 0.586, i: 162.3, node: 58.4, peri: 111.3, tp: 2446467.4 };
    const p = smallBodyPosition(el, el.tp);
    expect(Math.hypot(...p)).toBeCloseTo(0.586, 6);
    expect(smallBodyPeriod(el) / 365.25).toBeCloseTo(75.3, 0);
    expect(smallBodyPeriod({ ...el, e: 1.2 })).toBe(Infinity);
  });

  it('gives sensible magnitudes', () => {
    // Ceres at opposition (r 2.77, Δ 1.77 AU): about magnitude 7.
    expect(asteroidMagnitude(2.77, 1.77, 2 * DEG, { H: 3.34, G: 0.12, diameterKm: 939, albedo: 0.09 })).toBeCloseTo(7, 0);
    // Without H, from size and albedo: Vesta (H ≈ 3.2).
    expect(asteroidMagnitude(1, 1, 0, { H: null, G: null, diameterKm: 525, albedo: 0.42 })).toBeCloseTo(3.2, 0);
    expect(cometMagnitude(1, 1, 5.5, 8)).toBeCloseTo(5.5, 6);
  });
});
