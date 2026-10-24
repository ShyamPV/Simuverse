import { describe, expect, it } from 'vitest';
import fx from './__fixtures__/horizons-observer.json' with { type: 'json' };
import { apparentBody, observerState } from './apparent.ts';
import { greenwichMeanSiderealTime, hoursToRadians } from './coords.ts';
import { earthOrientation, nutation, refraction } from './earth.ts';
import type { SolarBodyId } from './ephemeris.ts';
import { bodyPhotometry } from './magnitudes.ts';
import { loadTestEphemeris } from './testing.ts';
import { astroTimeFromUnixMs, jdFromUnixMs, unixMsFromJd } from './time.ts';
import { ARCSEC, DEG } from './units.ts';

const eph = loadTestEphemeris();
const sites = fx.sites as Record<string, { lon: number; lat: number; heightKm: number }>;
const loc = (site: string) => {
  const s = sites[site]!;
  return { lat: s.lat * DEG, lon: s.lon * DEG, height: s.heightKm * 1000 };
};
/** Smallest signed difference of two angles in degrees, returned in arcseconds. */
const dArcsec = (a: number, b: number) => (Math.abs(((a - b + 540) % 360) - 180) * 3600);

describe('nutation and sidereal time', () => {
  it('matches Meeus example 22.a (1987-04-10 0h TD) to the low-precision series accuracy', () => {
    const T = (2446895.5 - 2451545) / 36525;
    const { dpsi, deps } = nutation(T);
    expect(Math.abs(dpsi / ARCSEC - -3.788)).toBeLessThan(0.5);
    expect(Math.abs(deps / ARCSEC - 9.443)).toBeLessThan(0.1);
  });

  it('gives apparent sidereal time of Meeus example 12.a (13h10m46.1351s)', () => {
    const jd = jdFromUnixMs(Date.UTC(1987, 3, 10));
    const { gast } = earthOrientation(jd + 55.2 / 86400, jd);
    expect(Math.abs(gast - hoursToRadians(13, 10, 46.1351)) / ARCSEC).toBeLessThan(0.6);
    expect(gast).not.toBe(greenwichMeanSiderealTime(jd));
  });

  it('has refraction ≈ 34′ at the apparent horizon (true altitude −34′), 29′ at true 0°, 1′ at 45°', () => {
    expect(refraction((-34 / 60) * DEG) / (DEG / 60)).toBeCloseTo(34.4, 0);
    expect(refraction(0) / (DEG / 60)).toBeCloseTo(29, 0);
    expect(refraction(45 * DEG) / (DEG / 60)).toBeCloseTo(1.0, 1);
  });
});

describe('topocentric apparent places vs JPL Horizons', () => {
  // RA/Dec: bounded by the 4-term nutation series (~1″).
  const TOL_ARCSEC = 2;
  // Alt/az: we take UT1 = UTC; Horizons applies the measured UT1−UTC (|ΔUT1| < 0.9 s ⇒ < 13.5″).
  const TOL_HORIZONTAL_ARCSEC = 14;
  for (const row of fx.observer) {
    it(`${row.body} from ${row.site} at JD ${row.jdUt}`, () => {
      const t = astroTimeFromUnixMs(unixMsFromJd(row.jdUt));
      const obs = observerState(eph, t, loc(row.site));
      const p = apparentBody(eph, obs, row.body as SolarBodyId);
      expect(dArcsec(p.raJ2000 / DEG, row.raJ2000) * Math.cos(row.decJ2000 * DEG)).toBeLessThan(TOL_ARCSEC);
      expect(dArcsec(p.decJ2000 / DEG, row.decJ2000)).toBeLessThan(TOL_ARCSEC);
      expect(dArcsec(p.ra / DEG, row.ra) * Math.cos(row.dec * DEG)).toBeLessThan(TOL_ARCSEC);
      expect(dArcsec(p.dec / DEG, row.dec)).toBeLessThan(TOL_ARCSEC);
      expect(dArcsec(p.horizontal.alt / DEG, row.alt)).toBeLessThan(TOL_HORIZONTAL_ARCSEC);
      expect(dArcsec(p.horizontal.az / DEG, row.az) * Math.cos(row.alt * DEG)).toBeLessThan(TOL_HORIZONTAL_ARCSEC);
      expect(Math.abs(p.distanceKm / 149597870.7 / row.deltaAu - 1)).toBeLessThan(1e-6);
    });
  }
});

describe('visual magnitudes vs JPL Horizons', () => {
  // Horizons uses the newer Mallama & Hilton (2018) models; the classic formulae agree to a few tenths.
  const TOL: Record<string, number> = { sun: 0.05, moon: 0.4, mercury: 0.5, venus: 0.3, mars: 0.3, jupiter: 0.2, saturn: 0.4, uranus: 0.2, neptune: 0.2 };
  for (const row of fx.observer.filter((r) => r.mag !== null)) {
    it(`${row.body} from ${row.site} at JD ${row.jdUt}`, () => {
      const obs = observerState(eph, astroTimeFromUnixMs(unixMsFromJd(row.jdUt)), loc(row.site));
      expect(Math.abs(bodyPhotometry(eph, obs, row.body as SolarBodyId).magnitude - row.mag!)).toBeLessThan(TOL[row.body]!);
    });
  }
});
