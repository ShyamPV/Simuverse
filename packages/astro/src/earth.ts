/**
 * Earth orientation and observer geometry.
 *
 * GCRS → true equator & equinox of date uses the IAU 2006 Fukushima–Williams
 * precession angles (frame bias included, as in SOFA iauPfw06/iauFw2m) with
 * the four-term nutation of Meeus ch. 22 (±0.5″ in Δψ, ±0.1″ in Δε). Polar
 * motion is ignored (< 0.5″). Overall accuracy is about an arcsecond.
 */

import { EQUATORIAL_TO_ECLIPTIC, greenwichMeanSiderealTime } from './coords.ts';
import { centuriesSinceJ2000 } from './time.ts';
import { ARCSEC, DEG } from './units.ts';
import { type Mat3, type Vec3, mulMat3, rotX, rotZ, transpose, wrap2Pi } from './vec.ts';

export const WGS84_A_KM = 6378.137;
export const WGS84_F = 1 / 298.257223563;
/** Earth's rotation rate, rad/s (IERS). */
export const EARTH_OMEGA = 7.292115e-5;

export interface Nutation {
  /** Nutation in longitude, radians. */
  dpsi: number;
  /** Nutation in obliquity, radians. */
  deps: number;
}

/** Low-precision nutation (Meeus ch. 22); T in Julian centuries TT. */
export function nutation(T: number): Nutation {
  const omega = (125.04452 - 1934.136261 * T) * DEG;
  const L = (280.4665 + 36000.7698 * T) * DEG;
  const Lp = (218.3165 + 481267.8813 * T) * DEG;
  return {
    dpsi: (-17.2 * Math.sin(omega) - 1.32 * Math.sin(2 * L) - 0.23 * Math.sin(2 * Lp) + 0.21 * Math.sin(2 * omega)) * ARCSEC,
    deps: (9.2 * Math.cos(omega) + 0.57 * Math.cos(2 * L) + 0.1 * Math.cos(2 * Lp) - 0.09 * Math.cos(2 * omega)) * ARCSEC,
  };
}

/** IAU 2006 Fukushima–Williams angles (γ̄, φ̄, ψ̄, εA), radians; T in Julian centuries TT. */
export function fukushimaWilliams(T: number): [number, number, number, number] {
  const gamb = (-0.052928 + (10.556378 + (0.4932044 + (-0.00031238 + (-0.000002788 + 0.000000026 * T) * T) * T) * T) * T) * ARCSEC;
  const phib = (84381.412819 + (-46.811016 + (0.0511268 + (0.00053289 + (-0.00000044 - 0.0000000176 * T) * T) * T) * T) * T) * ARCSEC;
  const psib = (-0.041775 + (5038.481484 + (1.5584175 + (-0.00018522 + (-0.000026452 - 0.0000000148 * T) * T) * T) * T) * T) * ARCSEC;
  const epsa = (84381.406 + (-46.836769 + (-0.0001831 + (0.0020034 + (-0.000000576 - 0.0000000434 * T) * T) * T) * T) * T) * ARCSEC;
  return [gamb, phib, psib, epsa];
}

export interface EarthOrientation {
  /** GCRS (ICRS axes) → true equator and equinox of date. */
  npb: Mat3;
  /** Greenwich apparent sidereal time, radians. */
  gast: number;
  /** GCRS → ITRS (terrestrial, x → Greenwich, z → pole). */
  gcrsToItrs: Mat3;
  /** ITRS → ecliptic J2000 (engine world axes). */
  itrsToEcliptic: Mat3;
  /** True obliquity of date, radians. */
  trueObliquity: number;
  nutation: Nutation;
}

export function earthOrientation(jdTt: number, jdUt1: number): EarthOrientation {
  const T = centuriesSinceJ2000(jdTt);
  const [gamb, phib, psib, epsa] = fukushimaWilliams(T);
  const nut = nutation(T);
  // NPB = R1(−ε) · R3(−ψ) · R1(φ̄) · R3(γ̄), with ψ = ψ̄ + Δψ, ε = εA + Δε (SOFA iauFw2m).
  const npb = mulMat3(rotX(-(epsa + nut.deps)), mulMat3(rotZ(-(psib + nut.dpsi)), mulMat3(rotX(phib), rotZ(gamb))));
  const gast = wrap2Pi(greenwichMeanSiderealTime(jdUt1, jdTt) + nut.dpsi * Math.cos(epsa));
  const gcrsToItrs = mulMat3(rotZ(gast), npb);
  return {
    npb,
    gast,
    gcrsToItrs,
    itrsToEcliptic: mulMat3(EQUATORIAL_TO_ECLIPTIC, transpose(gcrsToItrs)),
    trueObliquity: epsa + nut.deps,
    nutation: nut,
  };
}

export interface GeodeticLocation {
  /** Geodetic latitude, radians (north positive). */
  lat: number;
  /** Longitude, radians (east positive). */
  lon: number;
  /** Height above the WGS84 ellipsoid, metres. */
  height: number;
}

/** Observer position in ITRS, km (WGS84). */
export function geodeticToItrs(loc: GeodeticLocation, out: Vec3 = [0, 0, 0]): Vec3 {
  const e2 = WGS84_F * (2 - WGS84_F);
  const sl = Math.sin(loc.lat), cl = Math.cos(loc.lat);
  const N = WGS84_A_KM / Math.sqrt(1 - e2 * sl * sl);
  const h = loc.height / 1000;
  out[0] = (N + h) * cl * Math.cos(loc.lon);
  out[1] = (N + h) * cl * Math.sin(loc.lon);
  out[2] = (N * (1 - e2) + h) * sl;
  return out;
}

/** Local east/north/up unit vectors in ITRS for a geodetic location. */
export function enuBasis(loc: GeodeticLocation): { east: Vec3; north: Vec3; up: Vec3 } {
  const sl = Math.sin(loc.lat), cl = Math.cos(loc.lat);
  const so = Math.sin(loc.lon), co = Math.cos(loc.lon);
  return {
    east: [-so, co, 0],
    north: [-sl * co, -sl * so, cl],
    up: [cl * co, cl * so, sl],
  };
}

export interface AltAz {
  /** Altitude, radians. */
  alt: number;
  /** Azimuth from north through east, radians [0, 2π). */
  az: number;
}

/** Horizontal coordinates of an ITRS direction for an observer. */
export function itrsToAltAz(dirItrs: Readonly<Vec3>, loc: GeodeticLocation): AltAz {
  const { east, north, up } = enuBasis(loc);
  const l = Math.hypot(dirItrs[0], dirItrs[1], dirItrs[2]) || 1;
  const e = (dirItrs[0] * east[0] + dirItrs[1] * east[1]) / l;
  const n = (dirItrs[0] * north[0] + dirItrs[1] * north[1] + dirItrs[2] * north[2]) / l;
  const u = (dirItrs[0] * up[0] + dirItrs[1] * up[1] + dirItrs[2] * up[2]) / l;
  return { alt: Math.asin(Math.max(-1, Math.min(1, u))), az: wrap2Pi(Math.atan2(e, n)) };
}

/**
 * Atmospheric refraction (Sæmundsson 1986) for a geometric altitude, at
 * 1010 hPa and 10 °C, radians. Clamped below −1°, where it is meaningless.
 */
export function refraction(altGeometric: number): number {
  const h = Math.max(altGeometric / DEG, -1);
  const R = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG); // arcminutes
  return Math.max(R, 0) * (DEG / 60);
}
