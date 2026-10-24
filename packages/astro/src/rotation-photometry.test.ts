import { describe, expect, it } from 'vitest';
import { earthRotationAngle } from './coords.ts';
import { apparentMagnitude, blackbodyRgb, bvToTemperature } from './photometry.ts';
import { bodyToEclipticMatrix } from './rotation.ts';
import { OBLIQUITY_J2000 } from './coords.ts';
import { DEG } from './units.ts';
import { type Vec3, angleBetween, mulMat3Vec } from './vec.ts';

describe('body orientation', () => {
  it("tilts Earth's pole from the ecliptic pole by the obliquity", () => {
    const m = bodyToEclipticMatrix('earth', 2451545.0)!;
    const pole = mulMat3Vec(m, [0, 0, 1]);
    expect(angleBetween(pole, [0, 0, 1])).toBeCloseTo(OBLIQUITY_J2000, 4);
  });

  it("points Earth's prime meridian at the Earth rotation angle", () => {
    // Greenwich hour angle from the equinox ≈ ERA (differs by the equation of the origins, ~0.3°).
    for (const jd of [2451545.0, 2455000.25, 2460000.75]) {
      const m = bodyToEclipticMatrix('earth', jd)!;
      const meridian = mulMat3Vec(m, [1, 0, 0]);
      const eq: Vec3 = [
        meridian[0],
        meridian[1] * Math.cos(OBLIQUITY_J2000) - meridian[2] * Math.sin(OBLIQUITY_J2000),
        meridian[1] * Math.sin(OBLIQUITY_J2000) + meridian[2] * Math.cos(OBLIQUITY_J2000),
      ];
      const ra = Math.atan2(eq[1], eq[0]);
      const diff = Math.abs(((ra - earthRotationAngle(jd) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(diff / DEG).toBeLessThan(0.5);
    }
  });
});

describe('photometry', () => {
  it('gives the Sun ≈ 5770 K from B−V 0.656', () => {
    expect(bvToTemperature(0.656)).toBeGreaterThan(5650);
    expect(bvToTemperature(0.656)).toBeLessThan(5900);
  });

  it('colours hot stars blue and cool stars red', () => {
    const [r1, , b1] = blackbodyRgb(3000);
    const [r2, , b2] = blackbodyRgb(15000);
    expect(r1).toBe(1);
    expect(b1).toBeLessThan(0.3);
    expect(b2).toBe(1);
    expect(r2).toBeLessThan(0.85);
  });

  it('computes distance modulus', () => {
    expect(apparentMagnitude(4.83, 10)).toBeCloseTo(4.83);
    // Sirius: M = 1.42 at 2.64 pc → m ≈ −1.47
    expect(apparentMagnitude(1.42, 2.637)).toBeCloseTo(-1.47, 1);
  });
});
