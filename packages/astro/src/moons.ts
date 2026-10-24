/**
 * Major planetary moons (beyond Earth's Moon, which comes from DE440), from
 * mean elements fitted to JPL Horizons by tools/build-moons.mjs: a Keplerian
 * ellipse in an equatorial frame of the planet, with linearly precessing node
 * and apse and long-period librations of the mean longitude (Mimas–Tethys).
 * Typical error 0.01–0.2° along the orbit over 1950–2050 (Phobos and Deimos
 * about 0.7°), growing slowly outside that range.
 */

import { type ApparentPlace, type ObserverState, apparentFromVector, lightTimeVector } from './apparent.ts';
import { type BodyInfo, SOLAR_SYSTEM } from './bodies.ts';
import { EQUATORIAL_TO_ECLIPTIC } from './coords.ts';
import { AU_KM, type Ephemeris, type SolarBodyId } from './ephemeris.ts';
import type { Photometry } from './magnitudes.ts';
import { MOON_ELEMENTS } from './moonElements.ts';
import { J2000 } from './time.ts';
import { DEG } from './units.ts';
import { type Mat3, type Vec3, angleBetween, length, mulMat3, mulMat3Vec, rotX, rotZ, transpose } from './vec.ts';

export interface MoonElementsRecord {
  id: string;
  name: string;
  parent: string;
  radiusKm: number;
  /** GM, km³/s². */
  gm: number;
  /** Geometric albedo. */
  albedo: number;
  color: string;
  /** Pole (RA, Dec in degrees, ICRF) of the reference plane the elements are measured in. */
  pole: [number, number];
  /** RMS along-orbit residual of the fit against Horizons, degrees. */
  fitRmsDeg: number;
  el: {
    a: number; e: number; i: number;
    lambda0: number; n: number; ndot: number;
    varpi0: number; varpiDot: number;
    Omega0: number; OmegaDot: number;
    /** [sin amplitude, cos amplitude, angular frequency per day] terms added to λ. */
    lib: [number, number, number][];
  };
}

const G = 6.6743e-20; // km³ kg⁻¹ s⁻²

export const MOONS: readonly BodyInfo[] = MOON_ELEMENTS.map((m) => ({
  id: m.id, name: m.name, kind: 'moon', parent: m.parent, radius: m.radiusKm * 1e3, polarRadius: m.radiusKm * 1e3,
  mass: m.gm / G, color: m.color,
}));

/** Sun, planets, Pluto, Earth's Moon and the fitted moons. */
export const ALL_BODIES: readonly BodyInfo[] = [...SOLAR_SYSTEM, ...MOONS];
export const findBody = (id: string): BodyInfo | undefined => ALL_BODIES.find((b) => b.id === id);

const RECORDS = new Map(MOON_ELEMENTS.map((m) => [m.id, m]));
const TO_ECLIPTIC = new Map<string, Mat3>(
  MOON_ELEMENTS.map((m) => {
    const [ra, dec] = m.pole;
    const icrfToPlane = mulMat3(rotX((90 - dec) * DEG), rotZ((90 + ra) * DEG));
    return [m.id, mulMat3(EQUATORIAL_TO_ECLIPTIC, transpose(icrfToPlane))];
  }),
);

export const isFittedMoon = (id: string): boolean => RECORDS.has(id);
export const moonRecord = (id: string): MoonElementsRecord | undefined => RECORDS.get(id);

/** Moon position relative to its planet, ecliptic J2000, km. */
export function moonPosition(id: string, jdTdb: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const m = RECORDS.get(id);
  if (!m) throw new Error(`Unknown moon ${id}`);
  const el = m.el;
  const t = jdTdb - J2000;
  let lambda = el.lambda0 + el.n * t + el.ndot * t * t;
  for (const [s, c, f] of el.lib) lambda += s * Math.sin(f * t) + c * Math.cos(f * t);
  const varpi = el.varpi0 + el.varpiDot * t;
  const Omega = el.Omega0 + el.OmegaDot * t;
  const M = lambda - varpi, w = varpi - Omega, e = el.e;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = el.a * (Math.cos(E) - e), yp = el.a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Omega), sO = Math.sin(Omega);
  const ci = Math.cos(el.i), si = Math.sin(el.i);
  const x1 = cw * xp - sw * yp, y1 = sw * xp + cw * yp;
  out[0] = cO * x1 - sO * ci * y1;
  out[1] = sO * x1 + cO * ci * y1;
  out[2] = si * y1;
  return mulMat3Vec(TO_ECLIPTIC.get(id)!, out, out);
}

/** Orbital period, days. */
export const moonPeriodDays = (id: string): number => (2 * Math.PI) / RECORDS.get(id)!.el.n;

/**
 * Visual magnitude from size and geometric albedo (H = 5 log₁₀(1329 km / (D √p))),
 * with a linear phase law; r, Δ in AU, phase angle in degrees.
 */
export function moonMagnitude(id: string, r: number, delta: number, phaseDeg: number): number {
  const m = RECORDS.get(id)!;
  const H = 5 * Math.log10(1329 / (2 * m.radiusKm * Math.sqrt(m.albedo)));
  return H + 5 * Math.log10(r * delta) + 0.03 * phaseDeg;
}

/** Apparent place of a moon: its planet's light-time vector plus the moon's offset at emission time. */
export function apparentMoon(eph: Ephemeris, obs: ObserverState, id: string): ApparentPlace {
  const m = RECORDS.get(id)!;
  const P: Vec3 = [0, 0, 0];
  const tau = lightTimeVector(eph, obs, m.parent as SolarBodyId, P);
  const off = moonPosition(id, obs.time.jdTdb - tau);
  return apparentFromVector(obs, [P[0] + off[0], P[1] + off[1], P[2] + off[2]], tau);
}

/** Magnitude and phase of a moon as seen by the observer. */
export function moonPhotometry(eph: Ephemeris, obs: ObserverState, id: string): Photometry {
  const m = RECORDS.get(id)!;
  const P: Vec3 = [0, 0, 0];
  const tau = lightTimeVector(eph, obs, m.parent as SolarBodyId, P);
  const jd = obs.time.jdTdb - tau;
  const off = moonPosition(id, jd);
  const toBody: Vec3 = [P[0] + off[0], P[1] + off[1], P[2] + off[2]];
  const planet: Vec3 = [0, 0, 0], sun: Vec3 = [0, 0, 0];
  eph.barycentric(m.parent as SolarBodyId, jd, planet);
  eph.barycentric('sun', jd, sun);
  const fromSun: Vec3 = [planet[0] + off[0] - sun[0], planet[1] + off[1] - sun[1], planet[2] + off[2] - sun[2]];
  const phase = angleBetween([-fromSun[0], -fromSun[1], -fromSun[2]], [-toBody[0], -toBody[1], -toBody[2]]);
  return {
    magnitude: moonMagnitude(id, length(fromSun) / AU_KM, length(toBody) / AU_KM, phase / DEG),
    phaseAngle: phase,
    illuminated: (1 + Math.cos(phase)) / 2,
  };
}
