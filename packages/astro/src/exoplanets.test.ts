import { describe, expect, it } from 'vitest';
import { exoplanetOrbit, exoplanetPosition, planetClassLabel, radiusFromMass } from './exoplanets.ts';
import {
  bolometricCorrection, habitableZone, luminosityFromAbsMag, radiusFromLuminosity, starPhysics, teffFromBv,
} from './stellar.ts';
import { AU } from './units.ts';
import type { Vec3 } from './vec.ts';

describe('stellar estimates', () => {
  it('recovers the Sun from its catalogue values', () => {
    const sun = starPhysics(4.83, 0.65);
    expect(sun.teff).toBeGreaterThan(5650);
    expect(sun.teff).toBeLessThan(5900);
    expect(sun.lum).toBeCloseTo(1, 1);
    expect(sun.radiusSun).toBeCloseTo(1, 1);
  });

  it('gives textbook bolometric corrections', () => {
    expect(bolometricCorrection(5772)).toBeCloseTo(-0.08, 1);
    expect(bolometricCorrection(3500)).toBeCloseTo(-2.3, 1);
    expect(bolometricCorrection(30000)).toBeCloseTo(-2.9, 1);
  });

  it('makes Sirius A and Betelgeuse the right sizes', () => {
    // Sirius A: M_V 1.42, B−V 0.00 → ~25 L☉, ~1.7 R☉.
    const sirius = starPhysics(1.42, 0.0);
    expect(sirius.lum).toBeGreaterThan(18);
    expect(sirius.lum).toBeLessThan(35);
    expect(sirius.radiusSun).toBeGreaterThan(1.4);
    expect(sirius.radiusSun).toBeLessThan(2.2);
    // Betelgeuse: a red supergiant hundreds of solar radii across.
    const t = teffFromBv(1.85);
    expect(radiusFromLuminosity(luminosityFromAbsMag(-5.85, t), t)).toBeGreaterThan(300);
  });

  it('puts the Sun’s conservative habitable zone at 0.95–1.67 AU', () => {
    const hz = habitableZone(1, 5772);
    expect(hz.inner).toBeCloseTo(0.95, 2);
    expect(hz.outer).toBeCloseTo(1.676, 2);
  });
});

describe('exoplanet sizes', () => {
  it('follows the mass–radius relation across regimes', () => {
    expect(radiusFromMass(1)).toBeCloseTo(1, 5);
    expect(radiusFromMass(17)).toBeCloseTo(4.1, 0); // Neptune-mass → ~4 R⊕
    expect(radiusFromMass(318)).toBeGreaterThan(10); // Jupiter-mass → ~1 R♃
    expect(radiusFromMass(318)).toBeLessThan(14);
    expect(planetClassLabel(13, 1300)).toBe('Hot Jupiter');
    expect(planetClassLabel(1.1, 255)).toBe('Rocky planet');
  });
});

describe('exoplanet orbits', () => {
  const los: Vec3 = [0, 1, 0];
  it('derives the semi-major axis from the period and star mass', () => {
    const o = exoplanetOrbit({ periodDays: 365.25, aAU: null, ecc: 0, inclDeg: 90, argPeriDeg: null, transitMidJd: null }, 1, los, 0.3, 0)!;
    expect(o.a / AU).toBeCloseTo(1, 2);
  });

  it('respects the inclination to the sky plane', () => {
    const faceOn = exoplanetOrbit({ periodDays: 10, aAU: 0.1, ecc: 0, inclDeg: 0, argPeriDeg: 0, transitMidJd: null }, 1, los, 1, 0)!;
    expect(Math.abs(faceOn.normal[1])).toBeCloseTo(1, 6);
    const edgeOn = exoplanetOrbit({ periodDays: 10, aAU: 0.1, ecc: 0, inclDeg: 90, argPeriDeg: 0, transitMidJd: null }, 1, los, 1, 0)!;
    expect(Math.abs(edgeOn.normal[1])).toBeCloseTo(0, 6);
  });

  it('puts a transiting planet between its star and the Sun at mid-transit', () => {
    const o = exoplanetOrbit({ periodDays: 3.5, aAU: 0.045, ecc: 0.2, inclDeg: 88, argPeriDeg: 40, transitMidJd: 2460000.25 }, 1.1, los, 2.2, 0)!;
    expect(o.approximatePhase).toBe(false);
    for (const k of [0, 3, -7]) {
      const p = exoplanetPosition(o, 2460000.25 + k * 3.5);
      const r = Math.hypot(...p);
      // Towards the Sun (−los) to within the 2° offset of an 88° inclination.
      expect(-p[1] / r).toBeGreaterThan(Math.cos(3 * (Math.PI / 180)));
    }
    // Half a period later it is behind the star.
    const behind = exoplanetPosition(o, 2460000.25 + 1.75);
    expect(behind[1]).toBeGreaterThan(0);
  });
});

describe('spectral types in words', () => {
  it('names the common classes', async () => {
    const { describeSpectralType } = await import('./stellar.ts');
    expect(describeSpectralType('M1-M2Ia-Iab', 3600)).toBe('Red supergiant');
    expect(describeSpectralType('G2V', 5772)).toBe('Yellow main-sequence star');
    expect(describeSpectralType('K1.5III', 4300)).toBe('Orange giant');
    expect(describeSpectralType('M5.5Ve', 3000)).toBe('Red dwarf');
    expect(describeSpectralType('DA2', 25000)).toBe('White dwarf');
    expect(describeSpectralType('A1V', 9900)).toBe('White main-sequence star');
    expect(describeSpectralType(undefined, 4000)).toBe('Orange star');
  });
});
