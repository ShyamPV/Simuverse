/**
 * Exoplanet orbits and sizes from archive parameters.
 *
 * Catalogues give the orbit's size, shape and inclination to the sky plane,
 * but almost never its orientation on the sky (longitude of the node), so
 * that angle is seeded per system: planets of one system share it, which
 * keeps multi-planet systems coplanar. Where a transit (or conjunction) time
 * is known the planet's phase is real; otherwise it is seeded too, and the
 * result is flagged approximate.
 */

import { EQUATORIAL_TO_ECLIPTIC } from './coords.ts';
import { AU, DEG } from './units.ts';
import { type Vec3, mulMat3Vec } from './vec.ts';

const EARTH_MASSES_PER_JUPITER = 317.83;
const GM_SUN = 1.32712440018e20; // m³/s²

/** Radius (Earth radii) from mass (Earth masses), Chen & Kipping (2017) "Forecaster" mean relation. */
export function radiusFromMass(massEarth: number): number {
  if (massEarth < 2.04) return massEarth ** 0.279;
  if (massEarth < 0.414 * EARTH_MASSES_PER_JUPITER) return 0.808 * massEarth ** 0.589;
  return 17.4 * massEarth ** -0.044;
}

export type PlanetClass = 'rocky' | 'super-earth' | 'sub-neptune' | 'neptune' | 'giant';

export function planetClass(radiusEarth: number): PlanetClass {
  if (radiusEarth < 1.25) return 'rocky';
  if (radiusEarth < 2) return 'super-earth';
  if (radiusEarth < 4) return 'sub-neptune';
  if (radiusEarth < 8) return 'neptune';
  return 'giant';
}

export function planetClassLabel(radiusEarth: number, eqTempK: number | null): string {
  const hot = eqTempK !== null && eqTempK > 1000;
  switch (planetClass(radiusEarth)) {
    case 'rocky': return hot ? 'Hot rocky planet' : 'Rocky planet';
    case 'super-earth': return 'Super-Earth';
    case 'sub-neptune': return 'Sub-Neptune';
    case 'neptune': return hot ? 'Hot Neptune' : 'Neptune-like planet';
    case 'giant': return hot ? 'Hot Jupiter' : 'Gas giant';
  }
}

export interface ExoOrbitInput {
  periodDays: number | null;
  aAU: number | null;
  ecc: number | null;
  inclDeg: number | null;
  argPeriDeg: number | null;
  /** Transit midpoint / time of conjunction, JD. */
  transitMidJd: number | null;
}

export interface ExoOrbit {
  /** Semi-major axis, metres. */
  a: number;
  e: number;
  periodDays: number;
  /** Unit vectors (ecliptic J2000) towards periapsis and 90° ahead of it in the orbit plane. */
  p: Vec3;
  q: Vec3;
  /** Orbit normal (angular momentum direction). */
  normal: Vec3;
  epochJd: number;
  meanAnomalyAtEpoch: number;
  /** Phase from a seed rather than a measured transit/conjunction time. */
  approximatePhase: boolean;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const CELESTIAL_NORTH = mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, [0, 0, 1]);

/**
 * Builds an orbit around a host star.
 * @param losEcl unit vector Sun → host (ecliptic J2000)
 * @param nodeAngle seeded orientation of the orbit on the sky, radians
 * @param phaseSeed 0–1, used when no transit time is known
 * @param fallbackInclDeg inclination to use when unknown (e.g. the system's other planets)
 */
export function exoplanetOrbit(
  input: ExoOrbitInput, starMassSun: number, losEcl: Readonly<Vec3>, nodeAngle: number, phaseSeed: number,
  fallbackInclDeg = 60,
): ExoOrbit | null {
  const mu = GM_SUN * Math.max(starMassSun, 0.05);
  let periodDays = input.periodDays;
  let a = input.aAU !== null ? input.aAU * AU : null;
  if (a === null && periodDays !== null) a = Math.cbrt((mu * (periodDays * 86400) ** 2) / (4 * Math.PI ** 2));
  if (a === null) return null;
  if (periodDays === null) periodDays = (2 * Math.PI * Math.sqrt(a ** 3 / mu)) / 86400;
  const e = Math.min(Math.max(input.ecc ?? 0, 0), 0.97);
  const incl = (input.inclDeg ?? fallbackInclDeg) * DEG;
  const omega = (input.argPeriDeg ?? 0) * DEG;

  // Sky-plane basis at the star: u towards celestial north, v completing it.
  const toward: Vec3 = [-losEcl[0], -losEcl[1], -losEcl[2]];
  let u: Vec3 = [
    CELESTIAL_NORTH[0] - dot(CELESTIAL_NORTH, losEcl as Vec3) * losEcl[0],
    CELESTIAL_NORTH[1] - dot(CELESTIAL_NORTH, losEcl as Vec3) * losEcl[1],
    CELESTIAL_NORTH[2] - dot(CELESTIAL_NORTH, losEcl as Vec3) * losEcl[2],
  ];
  if (Math.hypot(...u) < 1e-6) u = [1, 0, 0];
  u = unit(u);
  const v = cross(losEcl as Vec3, u);
  // Inclination is measured from the sky plane: 0 = face-on (normal towards us), 90° = edge-on.
  const sky: Vec3 = [
    Math.cos(nodeAngle) * u[0] + Math.sin(nodeAngle) * v[0],
    Math.cos(nodeAngle) * u[1] + Math.sin(nodeAngle) * v[1],
    Math.cos(nodeAngle) * u[2] + Math.sin(nodeAngle) * v[2],
  ];
  const normal = unit([
    Math.cos(incl) * toward[0] + Math.sin(incl) * sky[0],
    Math.cos(incl) * toward[1] + Math.sin(incl) * sky[1],
    Math.cos(incl) * toward[2] + Math.sin(incl) * sky[2],
  ]);
  let node = cross(normal, toward);
  node = Math.hypot(...node) < 1e-6 ? u : unit(node);
  const side = cross(normal, node);
  const p = unit([
    Math.cos(omega) * node[0] + Math.sin(omega) * side[0],
    Math.cos(omega) * node[1] + Math.sin(omega) * side[1],
    Math.cos(omega) * node[2] + Math.sin(omega) * side[2],
  ]);
  const q = cross(normal, p);

  if (input.transitMidJd !== null) {
    // At transit/conjunction the planet is as close as it gets to the Sun-ward direction.
    const nu = Math.atan2(dot(q, toward), dot(p, toward));
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    return { a, e, periodDays, p, q, normal, epochJd: input.transitMidJd, meanAnomalyAtEpoch: E - e * Math.sin(E), approximatePhase: false };
  }
  return { a, e, periodDays, p, q, normal, epochJd: 2451545.0, meanAnomalyAtEpoch: phaseSeed * 2 * Math.PI, approximatePhase: true };
}

/** Planet position relative to its star at time jd, metres (ecliptic J2000). */
export function exoplanetPosition(o: ExoOrbit, jd: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const M = o.meanAnomalyAtEpoch + (2 * Math.PI * (jd - o.epochJd)) / o.periodDays;
  let E = M + o.e * Math.sin(M);
  for (let k = 0; k < 12; k++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
  const x = o.a * (Math.cos(E) - o.e), y = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  out[0] = x * o.p[0] + y * o.q[0];
  out[1] = x * o.p[1] + y * o.q[1];
  out[2] = x * o.p[2] + y * o.q[2];
  return out;
}
