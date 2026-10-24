/**
 * Artificial satellites from two-line element sets via SGP4/SDP4
 * (satellite.js, MIT). TEME output is rotated to ITRS with GMST (IAU 1982, as
 * SGP4 expects), ignoring polar motion — fine for visual work (≲ 15 m).
 */

import { type SatRec, gstime, sgp4, twoline2satrec } from 'satellite.js';
import { ECLIPTIC_TO_EQUATORIAL } from './coords.ts';
import { type GeodeticLocation, earthOrientation, geodeticToItrs, itrsToAltAz } from './earth.ts';
import type { Ephemeris } from './ephemeris.ts';
import { astroTimeFromUnixMs, jdFromUnixMs } from './time.ts';
import { type Vec3, mulMat3Vec } from './vec.ts';

export const EARTH_RADIUS_KM = 6378.137;

export interface Tle {
  name: string;
  line1: string;
  line2: string;
}

export interface Satellite {
  name: string;
  /** The element set this satellite was created from. */
  tle: Tle;
  noradId: number;
  satrec: SatRec;
  /** Element-set epoch, UTC Julian date. */
  epochJd: number;
  /** Standard magnitude (1000 km range, half illuminated); approximate. */
  stdMag: number;
}

/** Standard magnitudes for well-known objects (McCants/Heavens-Above style); others default. */
const STD_MAG: Record<number, number> = {
  25544: -1.3, // ISS
  48274: -0.5, // Tiangong (Tianhe core)
  20580: 2.2, // Hubble
};
const DEFAULT_STD_MAG = 4.0;

/** Parses 3-line (name + 2 lines) or bare 2-line TLE text. */
export function parseTleText(text: string): Tle[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out: Tle[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      const prev = lines[i - 1];
      const name = prev && !prev.startsWith('1 ') && !prev.startsWith('2 ') ? prev.trim() : `NORAD ${l.slice(2, 7).trim()}`;
      out.push({ name: name.replace(/^0 /, ''), line1: l, line2: lines[i + 1]! });
      i++;
    }
  }
  return out;
}

export function createSatellite(tle: Tle): Satellite | null {
  try {
    const satrec = twoline2satrec(tle.line1, tle.line2);
    if (satrec.error) return null;
    const noradId = Number(tle.line1.slice(2, 7));
    return { name: tle.name, tle, noradId, satrec, epochJd: satrec.jdsatepoch, stdMag: STD_MAG[noradId] ?? DEFAULT_STD_MAG };
  } catch {
    return null;
  }
}

/** Geocentric ITRS position (km) at a UTC Julian date; false if propagation fails (e.g. decayed). */
export function satelliteItrs(sat: Satellite, jdUtc: number, out: Vec3): boolean {
  const pv = sgp4(sat.satrec, (jdUtc - sat.epochJd) * 1440);
  if (!pv || typeof pv.position !== 'object') return false;
  const { x, y, z } = pv.position;
  const g = gstime(jdUtc);
  const c = Math.cos(g), s = Math.sin(g);
  // TEME → PEF: rotate by GMST about z.
  out[0] = c * x + s * y;
  out[1] = -s * x + c * y;
  out[2] = z;
  return true;
}

/** True if a geocentric point is inside Earth's (cylindrical) shadow, given the geocentric Sun vector. */
export function inEarthShadow(sat: Readonly<Vec3>, sun: Readonly<Vec3>): boolean {
  const sl = Math.hypot(sun[0], sun[1], sun[2]);
  const ux = sun[0] / sl, uy = sun[1] / sl, uz = sun[2] / sl;
  const along = sat[0] * ux + sat[1] * uy + sat[2] * uz;
  if (along > 0) return false;
  const px = sat[0] - along * ux, py = sat[1] - along * uy, pz = sat[2] - along * uz;
  return Math.hypot(px, py, pz) < EARTH_RADIUS_KM;
}

/** Diffuse-sphere magnitude estimate from standard magnitude, range (km) and phase angle (rad). */
export function satelliteMagnitude(stdMag: number, rangeKm: number, phase: number): number {
  const F = ((Math.PI - phase) * Math.cos(phase) + Math.sin(phase)) / Math.PI;
  return stdMag + 5 * Math.log10(rangeKm / 1000) - 2.5 * Math.log10(Math.max(F, 1e-4) * Math.PI);
}

/** Age of an element set in days at a given UTC Julian date. */
export const tleAgeDays = (sat: Satellite, jdUtc: number): number => jdUtc - sat.epochJd;

export interface SatellitePass {
  /** UTC ms when the satellite rises above / sets below the horizon (geometric). */
  rise: number;
  set: number;
  maxAltTime: number;
  /** Radians. */
  maxAlt: number;
  riseAz: number;
  setAz: number;
  /** Sunlit at culmination while the observer's Sun is below −6° (a naked-eye pass). */
  visible: boolean;
}

/**
 * Passes over an observer in [startMs, startMs + hours). Sampled every 20 s in
 * Earth-fixed coordinates, crossings refined by bisection to 1 s.
 */
export function satellitePasses(
  eph: Ephemeris, sat: Satellite, loc: GeodeticLocation, startMs: number, hours = 24,
): SatellitePass[] {
  const obs = geodeticToItrs(loc);
  const p: Vec3 = [0, 0, 0];
  const altAz = (ms: number) => {
    if (!satelliteItrs(sat, jdFromUnixMs(ms), p)) return null;
    return itrsToAltAz([p[0] - obs[0], p[1] - obs[1], p[2] - obs[2]], loc);
  };
  const alt = (ms: number) => altAz(ms)?.alt ?? -Math.PI;
  const step = 20_000;
  const end = startMs + hours * 3600_000;
  const passes: SatellitePass[] = [];
  let prev = alt(startMs);
  let riseT: number | null = prev > 0 ? startMs : null;
  for (let t = startMs + step; t <= end; t += step) {
    const a = alt(t);
    if (prev <= 0 && a > 0) riseT = bisect(alt, t - step, t);
    if (prev > 0 && a <= 0 && riseT !== null) {
      const setT = bisect(alt, t - step, t);
      passes.push(describePass(eph, sat, loc, riseT, setT, altAz));
      riseT = null;
    }
    prev = a;
  }
  return passes;
}

function bisect(f: (t: number) => number, a: number, b: number): number {
  const fa = f(a) > 0;
  while (b - a > 1000) {
    const m = (a + b) / 2;
    if (f(m) > 0 === fa) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

function describePass(
  eph: Ephemeris, sat: Satellite, loc: GeodeticLocation, rise: number, set: number,
  altAz: (ms: number) => { alt: number; az: number } | null,
): SatellitePass {
  // Golden-section search for culmination.
  let a = rise, b = set;
  const g = (Math.sqrt(5) - 1) / 2;
  while (b - a > 1000) {
    const c = b - g * (b - a), d = a + g * (b - a);
    if ((altAz(c)?.alt ?? -9) > (altAz(d)?.alt ?? -9)) b = d;
    else a = c;
  }
  const maxT = (a + b) / 2;
  const top = altAz(maxT)!;
  // Visibility at culmination: satellite sunlit, observer in at least civil twilight.
  const t = astroTimeFromUnixMs(maxT);
  const orient = earthOrientation(t.jdTt, t.jdUt1);
  const sun: Vec3 = [0, 0, 0], earth: Vec3 = [0, 0, 0];
  eph.barycentric('sun', t.jdTdb, sun);
  eph.barycentric('earth', t.jdTdb, earth);
  const sunItrs = mulMat3Vec(orient.gcrsToItrs, mulMat3Vec(ECLIPTIC_TO_EQUATORIAL, [sun[0] - earth[0], sun[1] - earth[1], sun[2] - earth[2]]));
  const satItrs: Vec3 = [0, 0, 0];
  satelliteItrs(sat, t.jdUtc, satItrs);
  const obs = geodeticToItrs(loc);
  const sunAlt = itrsToAltAz([sunItrs[0] - obs[0], sunItrs[1] - obs[1], sunItrs[2] - obs[2]], loc).alt;
  return {
    rise, set, maxAltTime: maxT, maxAlt: top.alt,
    riseAz: altAz(rise)?.az ?? 0, setAz: altAz(set)?.az ?? 0,
    visible: !inEarthShadow(satItrs, sunItrs) && sunAlt < -6 * (Math.PI / 180),
  };
}
