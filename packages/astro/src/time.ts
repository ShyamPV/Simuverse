/**
 * Time scales. UTC comes from the system clock; ephemerides need TT/TDB and
 * Earth rotation needs UT1. UT1 is approximated by UTC (|UT1−UTC| < 0.9 s).
 */

import { DAY_S, JULIAN_CENTURY_DAYS } from './units.ts';

export const J2000 = 2451545.0;
export const UNIX_EPOCH_JD = 2440587.5;
const TT_MINUS_TAI = 32.184;

/** TAI−UTC (s) from the given UTC date onward. Source: IERS Bulletin C. */
const LEAP_SECONDS: ReadonlyArray<readonly [number, number]> = [
  [Date.UTC(1972, 0, 1), 10], [Date.UTC(1972, 6, 1), 11], [Date.UTC(1973, 0, 1), 12],
  [Date.UTC(1974, 0, 1), 13], [Date.UTC(1975, 0, 1), 14], [Date.UTC(1976, 0, 1), 15],
  [Date.UTC(1977, 0, 1), 16], [Date.UTC(1978, 0, 1), 17], [Date.UTC(1979, 0, 1), 18],
  [Date.UTC(1980, 0, 1), 19], [Date.UTC(1981, 6, 1), 20], [Date.UTC(1982, 6, 1), 21],
  [Date.UTC(1983, 6, 1), 22], [Date.UTC(1985, 6, 1), 23], [Date.UTC(1988, 0, 1), 24],
  [Date.UTC(1990, 0, 1), 25], [Date.UTC(1991, 0, 1), 26], [Date.UTC(1992, 6, 1), 27],
  [Date.UTC(1993, 6, 1), 28], [Date.UTC(1994, 6, 1), 29], [Date.UTC(1996, 0, 1), 30],
  [Date.UTC(1997, 6, 1), 31], [Date.UTC(1999, 0, 1), 32], [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(2009, 0, 1), 34], [Date.UTC(2012, 6, 1), 35], [Date.UTC(2015, 6, 1), 36],
  [Date.UTC(2017, 0, 1), 37],
];

export const jdFromUnixMs = (ms: number): number => ms / (DAY_S * 1000) + UNIX_EPOCH_JD;
export const unixMsFromJd = (jd: number): number => (jd - UNIX_EPOCH_JD) * DAY_S * 1000;

/** Julian centuries since J2000.0 in the given scale's JD. */
export const centuriesSinceJ2000 = (jd: number): number => (jd - J2000) / JULIAN_CENTURY_DAYS;

/** TAI−UTC in seconds, or undefined before 1972 (when ΔT is used instead). */
export function taiMinusUtc(utcMs: number): number | undefined {
  if (utcMs < LEAP_SECONDS[0]![0]) return undefined;
  let v = LEAP_SECONDS[0]![1];
  for (const [t, s] of LEAP_SECONDS) {
    if (utcMs >= t) v = s;
    else break;
  }
  return v;
}

/**
 * ΔT = TT − UT1 in seconds for dates outside the leap-second era, using the
 * Espenak & Meeus (2006) polynomials, with the 2005–2050 branch extended
 * beyond 2050 by their long-term parabola.
 */
export function deltaT(year: number): number {
  const y = year;
  if (y < -500 || y >= 2150) {
    const u = (y - 1820) / 100;
    return -20 + 32 * u * u;
  }
  if (y < 500) {
    const u = y / 100;
    return 10583.6 - 1014.41 * u + 33.78311 * u ** 2 - 5.952053 * u ** 3 - 0.1798452 * u ** 4 +
      0.022174192 * u ** 5 + 0.0090316521 * u ** 6;
  }
  if (y < 1600) {
    const u = (y - 1000) / 100;
    return 1574.2 - 556.01 * u + 71.23472 * u ** 2 + 0.319781 * u ** 3 - 0.8503463 * u ** 4 -
      0.005050998 * u ** 5 + 0.0083572073 * u ** 6;
  }
  if (y < 1700) {
    const t = y - 1600;
    return 120 - 0.9808 * t - 0.01532 * t ** 2 + t ** 3 / 7129;
  }
  if (y < 1800) {
    const t = y - 1700;
    return 8.83 + 0.1603 * t - 0.0059285 * t ** 2 + 0.00013336 * t ** 3 - t ** 4 / 1174000;
  }
  if (y < 1860) {
    const t = y - 1800;
    return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3 - 0.00037436 * t ** 4 +
      0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7;
  }
  if (y < 1900) {
    const t = y - 1860;
    return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 +
      t ** 5 / 233174;
  }
  if (y < 1920) {
    const t = y - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (y < 1941) {
    const t = y - 1920;
    return 21.2 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3;
  }
  if (y < 1961) {
    const t = y - 1950;
    return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547;
  }
  if (y < 1986) {
    const t = y - 1975;
    return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718;
  }
  if (y < 2005) {
    const t = y - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 +
      0.00002373599 * t ** 5;
  }
  if (y < 2050) {
    const t = y - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t ** 2;
  }
  return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
}

/** TT − UTC in seconds for an instant given as UTC milliseconds. */
export function ttMinusUtc(utcMs: number): number {
  const tai = taiMinusUtc(utcMs);
  if (tai !== undefined) return tai + TT_MINUS_TAI;
  const year = 1970 + utcMs / (365.2425 * DAY_S * 1000);
  return deltaT(year);
}

/** TDB − TT in seconds (Fairhead & Bretagnon leading terms; < 2 ms). */
export function tdbMinusTt(jdTt: number): number {
  const g = (357.53 + 0.98560028 * (jdTt - J2000)) * (Math.PI / 180);
  return 0.001657 * Math.sin(g) + 0.000014 * Math.sin(2 * g);
}

/** One instant expressed in every time scale the engine uses. */
export interface AstroTime {
  readonly utcMs: number;
  readonly jdUtc: number;
  readonly jdUt1: number;
  readonly jdTt: number;
  readonly jdTdb: number;
}

export function astroTimeFromUnixMs(utcMs: number): AstroTime {
  const jdUtc = jdFromUnixMs(utcMs);
  const jdTt = jdUtc + ttMinusUtc(utcMs) / DAY_S;
  return {
    utcMs,
    jdUtc,
    jdUt1: jdUtc,
    jdTt,
    jdTdb: jdTt + tdbMinusTt(jdTt) / DAY_S,
  };
}

/** Builds an AstroTime from a TDB Julian date (inverse of the UTC path, iterated once). */
export function astroTimeFromJdTdb(jdTdb: number): AstroTime {
  let utcMs = unixMsFromJd(jdTdb);
  for (let i = 0; i < 3; i++) {
    const t = astroTimeFromUnixMs(utcMs);
    utcMs -= (t.jdTdb - jdTdb) * DAY_S * 1000;
  }
  return astroTimeFromUnixMs(utcMs);
}
