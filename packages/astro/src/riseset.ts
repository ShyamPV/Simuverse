/**
 * Rise, set, transit and twilight times by sampling the altitude curve and
 * refining sign changes with bisection (to ~1 s). Works for any target whose
 * apparent place can be computed at an arbitrary time.
 */

import { type ApparentPlace, apparentBody, apparentFixed, observerState } from './apparent.ts';
import type { GeodeticLocation } from './earth.ts';
import type { Ephemeris, SolarBodyId } from './ephemeris.ts';
import { astroTimeFromUnixMs } from './time.ts';
import { DEG } from './units.ts';
import type { Vec3 } from './vec.ts';

const ARCMIN = DEG / 60;
/** Standard refraction at the horizon. */
export const HORIZON_REFRACTION = 34 * ARCMIN;

/** Semi-diameters used for standard rise/set altitudes (upper limb). */
const SEMI_DIAMETER: Partial<Record<SolarBodyId, number>> = { sun: 16 * ARCMIN, moon: 15.5 * ARCMIN };

export type Target = { kind: 'body'; id: SolarBodyId } | { kind: 'fixed'; positionKm: Vec3 };

export interface RiseSetTransit {
  /** UTC milliseconds, or undefined if the event doesn't happen in the window. */
  rise?: number;
  set?: number;
  transit?: number;
  /** Altitude at transit, radians (airless). */
  transitAlt?: number;
  /** Above the rise/set altitude for the whole window. */
  alwaysUp: boolean;
  alwaysDown: boolean;
}

export function placeAt(eph: Ephemeris, loc: GeodeticLocation, target: Target, utcMs: number): ApparentPlace {
  const obs = observerState(eph, astroTimeFromUnixMs(utcMs), loc);
  return target.kind === 'body' ? apparentBody(eph, obs, target.id) : apparentFixed(obs, target.positionKm);
}

/** Standard rise/set altitude (airless, centre of disc): −(34′ + semi-diameter). */
export function standardAltitude(target: Target): number {
  const sd = target.kind === 'body' ? (SEMI_DIAMETER[target.id] ?? 0) : 0;
  return -(HORIZON_REFRACTION + sd);
}

/** Finds sign changes of f in [t0, t1], refined by bisection to `tol` ms. */
export function findCrossings(
  f: (t: number) => number, t0: number, t1: number, step: number, tol = 1000,
): { t: number; rising: boolean }[] {
  const out: { t: number; rising: boolean }[] = [];
  let a = t0, fa = f(a);
  while (a < t1) {
    const b = Math.min(a + step, t1);
    const fb = f(b);
    if (fa === 0 || Math.sign(fa) !== Math.sign(fb)) {
      let lo = a, hi = b, flo = fa;
      while (hi - lo > tol) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; }
        else hi = mid;
      }
      out.push({ t: (lo + hi) / 2, rising: fb > fa });
    }
    a = b;
    fa = fb;
  }
  return out;
}

/**
 * Rise, set and upper transit within [startMs, startMs + 24 h). `h0` overrides
 * the standard altitude (e.g. −6° for civil twilight on the Sun).
 */
export function riseSetTransit(
  eph: Ephemeris, loc: GeodeticLocation, target: Target, startMs: number, h0 = standardAltitude(target),
  spanMs = 86_400_000,
): RiseSetTransit {
  const end = startMs + spanMs;
  // Moon moves fast enough that 10-minute sampling can't miss a crossing; others likewise.
  const step = 10 * 60_000;
  const cache = new Map<number, { place: ApparentPlace; hourAngle: number }>();
  const at = (t: number) => {
    let s = cache.get(t);
    if (!s) {
      const obs = observerState(eph, astroTimeFromUnixMs(t), loc);
      const place = target.kind === 'body' ? apparentBody(eph, obs, target.id) : apparentFixed(obs, target.positionKm);
      s = { place, hourAngle: obs.orientation.gast + loc.lon - place.ra };
      cache.set(t, s);
    }
    return s;
  };
  const altFn = (t: number) => at(t).place.horizontal.alt - h0;
  const crossings = findCrossings(altFn, startMs, end, step);
  const rise = crossings.find((c) => c.rising)?.t;
  const set = crossings.find((c) => !c.rising)?.t;

  // Upper transit: the local hour angle passes through zero (sin rising, cos positive).
  const transit = findCrossings((t) => Math.sin(at(t).hourAngle), startMs, end, step)
    .find((c) => c.rising && Math.cos(at(c.t).hourAngle) > 0)?.t;

  const alt0 = altFn(startMs);
  return {
    rise,
    set,
    transit,
    transitAlt: transit !== undefined ? at(transit).place.horizontal.alt : undefined,
    alwaysUp: crossings.length === 0 && alt0 > 0,
    alwaysDown: crossings.length === 0 && alt0 <= 0,
  };
}

export interface Twilight {
  /** Sun at −6°, −12°, −18° in the evening (dusk) and morning (dawn), UTC ms. */
  civilDusk?: number; nauticalDusk?: number; astronomicalDusk?: number;
  civilDawn?: number; nauticalDawn?: number; astronomicalDawn?: number;
}

export function twilight(eph: Ephemeris, loc: GeodeticLocation, startMs: number): Twilight {
  const sun: Target = { kind: 'body', id: 'sun' };
  const at = (deg: number) => riseSetTransit(eph, loc, sun, startMs, -deg * DEG);
  const c = at(6), n = at(12), a = at(18);
  return {
    civilDusk: c.set, nauticalDusk: n.set, astronomicalDusk: a.set,
    civilDawn: c.rise, nauticalDawn: n.rise, astronomicalDawn: a.rise,
  };
}
