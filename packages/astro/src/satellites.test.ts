import { sgp4 } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { createSatellite, inEarthShadow, parseTleText, satelliteItrs, satelliteMagnitude, satellitePasses } from './satellites.ts';
import { loadTestEphemeris } from './testing.ts';
import { DEG } from './units.ts';

// Vallado et al. (2006) "Revisiting Spacetrack Report #3", verification case 00005.
const VANGUARD = `VANGUARD 1
1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753
2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667`;

describe('TLE parsing', () => {
  it('reads named three-line sets', () => {
    const [t] = parseTleText(VANGUARD);
    expect(t!.name).toBe('VANGUARD 1');
    expect(t!.line2.startsWith('2 00005')).toBe(true);
  });
});

describe('SGP4', () => {
  const sat = createSatellite(parseTleText(VANGUARD)[0]!)!;

  it('matches the Vallado verification vector at epoch (TEME, km)', () => {
    const pv = sgp4(sat.satrec, 0);
    expect(pv).not.toBeNull();
    expect(pv!.position.x).toBeCloseTo(7022.46529266, 4);
    expect(pv!.position.y).toBeCloseTo(-1400.08296755, 4);
    expect(pv!.position.z).toBeCloseTo(0.03995155, 4);
  });

  it('rotates TEME to ITRS without changing the radius', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(satelliteItrs(sat, sat.epochJd + 0.3, out)).toBe(true);
    const pv = sgp4(sat.satrec, 0.3 * 1440)!;
    // tsince is recomputed from Julian dates, so allow sub-metre float noise.
    expect(Math.hypot(...out)).toBeCloseTo(Math.hypot(pv.position.x, pv.position.y, pv.position.z), 3);
    expect(out[2]).toBeCloseTo(pv.position.z, 3);
  });
});

describe('satellitePasses', () => {
  const ISS = `ISS (ZARYA)
1 25544U 98067A   26296.69304404  .00008515  00000+0  16237-3 0  9995
2 25544  51.6336  24.1765 0006871 300.7285  59.3026 15.49021515591674`;
  const iss = createSatellite(parseTleText(ISS)[0]!)!;
  const eph = loadTestEphemeris();

  it('finds several ISS passes a day at mid-latitude, each rising before it sets', () => {
    const passes = satellitePasses(eph, iss, { lat: 51.48 * DEG, lon: 0, height: 0 }, Date.UTC(2026, 9, 24), 24);
    expect(passes.length).toBeGreaterThanOrEqual(3);
    for (const p of passes) {
      expect(p.set - p.rise).toBeGreaterThan(30_000);
      expect(p.set - p.rise).toBeLessThan(12 * 60_000); // LEO passes last minutes
      expect(p.maxAltTime).toBeGreaterThan(p.rise);
      expect(p.maxAltTime).toBeLessThan(p.set);
      expect(p.maxAlt).toBeGreaterThan(0);
    }
  });

  it('never passes over a site far outside its inclination band', () => {
    // ISS inclination 51.6°: from 80° N it never clears the horizon by much — and often not at all.
    const passes = satellitePasses(eph, iss, { lat: 89 * DEG, lon: 0, height: 0 }, Date.UTC(2026, 9, 24), 24);
    expect(passes.every((p) => p.maxAlt < 10 * DEG)).toBe(true);
  });
});

describe('visibility helpers', () => {
  it("detects Earth's shadow on the night side only", () => {
    const sun: [number, number, number] = [1.5e8, 0, 0];
    expect(inEarthShadow([-7000, 0, 0], sun)).toBe(true);
    expect(inEarthShadow([-7000, 7000, 0], sun)).toBe(false);
    expect(inEarthShadow([7000, 0, 0], sun)).toBe(false);
  });

  it('gives standard magnitude at 1000 km and half phase, brighter when full', () => {
    expect(satelliteMagnitude(-1.3, 1000, Math.PI / 2)).toBeCloseTo(-1.3, 6);
    expect(satelliteMagnitude(-1.3, 400, 0.3)).toBeLessThan(-3);
  });
});
