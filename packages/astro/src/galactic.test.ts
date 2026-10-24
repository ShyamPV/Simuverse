import { describe, expect, it } from 'vitest';
import { EQUATORIAL_TO_GALACTIC } from './coords.ts';
import {
  GALACTIC_CENTER_DISTANCE_PC, SUN_HEIGHT_PC, galacticCenterDirection, galactocentricFrame, galaxyBasis,
} from './galactic.ts';
import { DEG } from './units.ts';
import { type Vec3, angleBetween, dot, length, mulMat3Vec, sphericalToCartesian } from './vec.ts';

describe('galactocentric frame', () => {
  const { toEquatorial, sunPc } = galactocentricFrame();

  it('puts the Sun R₀ from the centre and z☉ above the plane', () => {
    expect(length(sunPc)).toBeCloseTo(GALACTIC_CENTER_DISTANCE_PC, 3);
    expect(sunPc[2]).toBeCloseTo(SUN_HEIGHT_PC, 6);
  });

  it('maps the Sun→centre vector onto Sgr A*', () => {
    const toCentre = mulMat3Vec(toEquatorial, [-sunPc[0], -sunPc[1], -sunPc[2]]);
    expect(angleBetween(toCentre, galacticCenterDirection()) / DEG).toBeLessThan(1e-6);
  });

  it('keeps galactocentric z within a fraction of a degree of the North Galactic Pole', () => {
    const z = mulMat3Vec(toEquatorial, [0, 0, 1]);
    const ngp = sphericalToCartesian(192.85948 * DEG, 27.12825 * DEG);
    expect(angleBetween(z, ngp) / DEG).toBeLessThan(0.3);
    // and the Sun is on the +z side of the plane
    expect(mulMat3Vec(EQUATORIAL_TO_GALACTIC, z)[2]).toBeGreaterThan(0.99);
  });
});

describe('galaxyBasis', () => {
  const los = sphericalToCartesian(10.68 * DEG, 41.27 * DEG); // M31

  it('returns an orthonormal frame', () => {
    const b = galaxyBasis(los, 38, 0.3);
    for (const v of [b.major, b.minor, b.normal]) expect(length(v)).toBeCloseTo(1, 9);
    expect(dot(b.major, b.minor)).toBeCloseTo(0, 9);
    expect(dot(b.major, b.normal)).toBeCloseTo(0, 9);
  });

  it('projects a disc back to the observed axis ratio and position angle', () => {
    const q = 0.45, pa = 38;
    const b = galaxyBasis(los, pa, q, false, 0);
    // Project the in-plane minor axis onto the sky: its length is the apparent axis ratio.
    const proj = (v: Vec3): Vec3 => {
      const d = dot(v, los);
      return [v[0] - d * los[0], v[1] - d * los[1], v[2] - d * los[2]];
    };
    expect(length(proj(b.minor))).toBeCloseTo(q, 6);
    expect(length(proj(b.major))).toBeCloseTo(1, 9); // major axis lies in the sky plane
    expect(b.inclination / DEG).toBeCloseTo(Math.acos(q) / DEG, 6);
    // Major axis at PA 38° east of north.
    const north = [0, 0, 1] as Vec3;
    const n0 = proj(north);
    const nn = n0.map((x) => x / length(n0)) as Vec3;
    expect(Math.acos(dot(b.major, nn)) / DEG).toBeCloseTo(pa, 4);
  });

  it('treats round galaxies as face-on', () => {
    const b = galaxyBasis(los, 0, 1);
    expect(angleBetween(b.normal, [-los[0], -los[1], -los[2]])).toBeLessThan(1e-6);
  });
});
