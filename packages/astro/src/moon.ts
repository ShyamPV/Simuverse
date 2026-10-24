/**
 * Low-precision geocentric Moon (Astronomical Almanac, "low precision formulae
 * for the Moon"; ~0.3° in longitude, ~0.2° in latitude). Milestone 2 replaces
 * it with an ELP/MPP02 or DE440-fitted series.
 */

import { AU, DEG } from './units.ts';
import { type Vec3, sphericalToCartesian } from './vec.ts';

const EARTH_EQUATORIAL_RADIUS_M = 6_378_137;
/** General precession in longitude, degrees per Julian century. */
const PRECESSION_DEG_PER_CY = 1.3969713;

const sind = (x: number) => Math.sin(x * DEG);
const cosd = (x: number) => Math.cos(x * DEG);

/** Geocentric ecliptic-J2000 position of the Moon in AU; T in Julian centuries TDB. */
export function moonGeocentricEcliptic(T: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const lonOfDate =
    218.32 + 481267.881 * T +
    6.29 * sind(135.0 + 477198.87 * T) -
    1.27 * sind(259.3 - 413335.36 * T) +
    0.66 * sind(235.7 + 890534.22 * T) +
    0.21 * sind(269.9 + 954397.74 * T) -
    0.19 * sind(357.5 + 35999.05 * T) -
    0.11 * sind(186.5 + 966404.03 * T);
  const lat =
    5.13 * sind(93.3 + 483202.02 * T) +
    0.28 * sind(228.2 + 960400.89 * T) -
    0.28 * sind(318.3 + 6003.15 * T) -
    0.17 * sind(217.6 - 407332.21 * T);
  const parallax =
    0.9508 +
    0.0518 * cosd(135.0 + 477198.87 * T) +
    0.0095 * cosd(259.3 - 413335.36 * T) +
    0.0078 * cosd(235.7 + 890534.22 * T) +
    0.0028 * cosd(269.9 + 954397.74 * T);

  const distAu = EARTH_EQUATORIAL_RADIUS_M / Math.sin(parallax * DEG) / AU;
  // Mean equinox of date → J2000 (longitude-only precession is adequate at this accuracy).
  const lonJ2000 = lonOfDate - PRECESSION_DEG_PER_CY * T;
  const v = sphericalToCartesian(lonJ2000 * DEG, lat * DEG, distAu);
  out[0] = v[0];
  out[1] = v[1];
  out[2] = v[2];
  return out;
}
