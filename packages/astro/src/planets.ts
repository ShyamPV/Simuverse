/**
 * Approximate planetary positions from Keplerian elements with linear rates:
 * E. M. Standish, "Keplerian Elements for Approximate Positions of the Major
 * Planets", JPL Solar System Dynamics, Table 1 (valid 1800–2050 AD).
 * Accuracy is arcminutes for the outer planets. Milestone 2 replaces this with
 * Chebyshev fits to DE440; this module remains as the fallback outside that span.
 */

import { type OrbitalElements, elementsToPosition } from './kepler.ts';
import { moonGeocentricEcliptic } from './moon.ts';
import { DEG } from './units.ts';
import { type Vec3, scale, sub } from './vec.ts';

export type PlanetId =
  | 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

/** Bodies with Keplerian fallback elements: the planets plus Pluto. */
export type KeplerBodyId = PlanetId | 'pluto';

export const PLANET_IDS: readonly PlanetId[] = [
  'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune',
];

/** [a (AU), e, I (deg), L (deg), ϖ (deg), Ω (deg)] at J2000 and per Julian century. */
type ElementRow = readonly [number, number, number, number, number, number];

const TABLE: Record<KeplerBodyId, readonly [ElementRow, ElementRow]> = {
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  ],
  venus: [
    [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  ],
  // Earth–Moon barycentre; the Earth is offset from it using the Moon model.
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  ],
  saturn: [
    [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  ],
  uranus: [
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  ],
  neptune: [
    [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  ],
  pluto: [
    [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  ],
};

/** Earth/Moon mass ratio (DE440). */
export const EARTH_MOON_MASS_RATIO = 81.30056907;

/** Osculating-style elements (ecliptic J2000, AU) at T Julian centuries TDB from J2000. */
export function planetElements(id: KeplerBodyId, T: number): OrbitalElements {
  const [p0, rate] = TABLE[id];
  const at = (k: number) => p0[k]! + rate[k]! * T;
  const peri = at(4);
  const node = at(5);
  return {
    a: at(0),
    e: at(1),
    i: at(2) * DEG,
    node: node * DEG,
    argPeri: (peri - node) * DEG,
    M: (at(3) - peri) * DEG,
  };
}

/** Heliocentric ecliptic-J2000 position of the planet's centre, in AU. */
export function planetHeliocentric(id: KeplerBodyId, T: number, out: Vec3 = [0, 0, 0]): Vec3 {
  elementsToPosition(planetElements(id, T), out);
  if (id === 'earth') {
    const moon = moonGeocentricEcliptic(T);
    sub(out, scale(moon, 1 / (1 + EARTH_MOON_MASS_RATIO)), out);
  }
  return out;
}

/** Orbital period in days from the element table's mean motion. */
export function planetPeriodDays(id: KeplerBodyId): number {
  return (360 / TABLE[id][1][3]) * 36525;
}
