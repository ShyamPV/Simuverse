/**
 * Reference-frame transforms. The engine's world axes are ecliptic J2000
 * (x → vernal equinox, z → ecliptic north pole); catalogues are ICRS
 * equatorial, which this module treats as equal to the J2000 mean equator.
 */

import { J2000, centuriesSinceJ2000 } from './time.ts';
import { ARCSEC, DEG } from './units.ts';
import { type Mat3, type Vec3, mulMat3Vec, rotX, transpose, wrap2Pi } from './vec.ts';

/** Mean obliquity of the ecliptic at J2000 (IAU 2006), radians. */
export const OBLIQUITY_J2000 = 84381.406 * ARCSEC;

/** Mean obliquity of date (IAU 2006 polynomial); T in Julian centuries TT. */
export function meanObliquity(T: number): number {
  return (
    (84381.406 - 46.836769 * T - 0.0001831 * T ** 2 + 0.0020034 * T ** 3 - 0.000000576 * T ** 4 -
      0.0000000434 * T ** 5) * ARCSEC
  );
}

/** ICRS/J2000 equatorial → ecliptic J2000. */
export const EQUATORIAL_TO_ECLIPTIC: Mat3 = rotX(OBLIQUITY_J2000);
export const ECLIPTIC_TO_EQUATORIAL: Mat3 = transpose(EQUATORIAL_TO_ECLIPTIC);

/**
 * ICRS equatorial → galactic (Hipparcos definition, ESA 1997 vol. 1 §1.5.3),
 * rows are the galactic x, y, z axes expressed in ICRS.
 */
export const EQUATORIAL_TO_GALACTIC: Mat3 = [
  -0.0548755604162154, -0.873437090234885, -0.4838350155487132,
  0.4941094278755837, -0.444829630973218, 0.7469822444972189,
  -0.8676661490190047, -0.1980763734312015, 0.4559837761750669,
];
export const GALACTIC_TO_EQUATORIAL: Mat3 = transpose(EQUATORIAL_TO_GALACTIC);

export const equatorialToEcliptic = (v: Vec3, out?: Vec3): Vec3 => mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, v, out);
export const eclipticToEquatorial = (v: Vec3, out?: Vec3): Vec3 => mulMat3Vec(ECLIPTIC_TO_EQUATORIAL, v, out);

/** Earth Rotation Angle (IAU 2000), radians, from a UT1 Julian date. */
export function earthRotationAngle(jdUt1: number): number {
  const d = jdUt1 - J2000;
  return wrap2Pi(2 * Math.PI * (0.779057273264 + 0.00273781191135448 * d + (d % 1)));
}

/**
 * Greenwich mean sidereal time (IAU 2006, ERA-based), radians.
 * jdTt is optional; using UT1 for both is accurate to ~0.1 ms of time.
 */
export function greenwichMeanSiderealTime(jdUt1: number, jdTt = jdUt1): number {
  const T = centuriesSinceJ2000(jdTt);
  const poly =
    (0.014506 + 4612.156534 * T + 1.3915817 * T ** 2 - 0.00000044 * T ** 3 - 0.000029956 * T ** 4) *
    ARCSEC;
  return wrap2Pi(earthRotationAngle(jdUt1) + poly);
}

export interface Horizontal {
  /** Altitude above the horizon, radians. */
  alt: number;
  /** Azimuth measured from north through east, radians in [0, 2π). */
  az: number;
}

/**
 * Equatorial (RA/Dec of date) → horizontal for an observer at geodetic
 * latitude `lat` and east longitude `lon` (radians), given sidereal time.
 */
export function equatorialToHorizontal(ra: number, dec: number, lat: number, lon: number, gmst: number): Horizontal {
  const H = gmst + lon - ra;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // Azimuth from south (Meeus), then shifted to north-based.
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
  return { alt, az: wrap2Pi(azSouth + Math.PI) };
}

export const hoursToRadians = (h: number, m = 0, s = 0): number => (h + m / 60 + s / 3600) * 15 * DEG;
export const degreesToRadians = (d: number, m = 0, s = 0): number =>
  Math.sign(d || 1) * (Math.abs(d) + m / 60 + s / 3600) * DEG;
