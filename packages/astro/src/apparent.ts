/**
 * Apparent places for a topocentric observer: light-time correction, annual +
 * diurnal aberration, precession–nutation to the true equator of date, then
 * horizontal coordinates and refraction. Gravitational light deflection is
 * ignored (≤ 0.01″ away from the Sun's limb).
 */

import { ECLIPTIC_TO_EQUATORIAL } from './coords.ts';
import {
  type AltAz, EARTH_OMEGA, type EarthOrientation, type GeodeticLocation, earthOrientation, geodeticToItrs,
  itrsToAltAz, refraction,
} from './earth.ts';
import { C_KM_PER_DAY, type Ephemeris, type SolarBodyId } from './ephemeris.ts';
import type { AstroTime } from './time.ts';
import { DAY_S } from './units.ts';
import { type Vec3, cartesianToSpherical, length, mulMat3Vec } from './vec.ts';

export interface ObserverState {
  time: AstroTime;
  location: GeodeticLocation;
  orientation: EarthOrientation;
  /** Barycentric position, km, ecliptic J2000. */
  position: Vec3;
  /** Barycentric velocity, km/day, ecliptic J2000 (orbital + rotation). */
  velocity: Vec3;
  /** Offset from Earth's centre, km, ecliptic J2000. */
  geocentric: Vec3;
  /** False when outside the DE440 span (fallback models in use). */
  precise: boolean;
}

export function observerState(eph: Ephemeris, time: AstroTime, location: GeodeticLocation): ObserverState {
  const orientation = earthOrientation(time.jdTt, time.jdUt1);
  const itrs = geodeticToItrs(location);
  const geocentric = mulMat3Vec(orientation.itrsToEcliptic, itrs);
  const position: Vec3 = [0, 0, 0];
  const precise = eph.barycentric('earth', time.jdTdb, position);
  position[0] += geocentric[0];
  position[1] += geocentric[1];
  position[2] += geocentric[2];
  const velocity = eph.barycentricVelocity('earth', time.jdTdb, [0, 0, 0]);
  // Diurnal motion: ω × r in ITRS (km/s → km/day).
  const rot = mulMat3Vec(orientation.itrsToEcliptic, [-EARTH_OMEGA * itrs[1], EARTH_OMEGA * itrs[0], 0]);
  velocity[0] += rot[0] * DAY_S;
  velocity[1] += rot[1] * DAY_S;
  velocity[2] += rot[2] * DAY_S;
  return { time, location, orientation, position, velocity, geocentric, precise };
}

export interface ApparentPlace {
  /** Astrometric ICRS right ascension / declination (light-time corrected, no aberration), radians. */
  raJ2000: number;
  decJ2000: number;
  /** Apparent right ascension / declination, true equator and equinox of date, radians. */
  ra: number;
  dec: number;
  /** Airless (geometric) horizontal coordinates. */
  horizontal: AltAz;
  /** Altitude including standard refraction, radians. */
  altRefracted: number;
  /** Observer → object distance, km (at emission time for solar-system bodies). */
  distanceKm: number;
  /** Apparent unit direction in ecliptic J2000 axes (with aberration): use this for rendering. */
  direction: Vec3;
  lightTimeDays: number;
}

/** Apparent place from an observer → object vector (ecliptic J2000, km, already light-time corrected). */
export function apparentFromVector(obs: ObserverState, P: Readonly<Vec3>, lightTimeDays = 0): ApparentPlace {
  const dist = length(P as Vec3);
  const u: Vec3 = [P[0] / dist, P[1] / dist, P[2] / dist];
  const astrometric = cartesianToSpherical(mulMat3Vec(ECLIPTIC_TO_EQUATORIAL, u));

  // First-order aberration (second-order terms < 0.001″).
  const k = 1 / C_KM_PER_DAY;
  const a: Vec3 = [u[0] + obs.velocity[0] * k, u[1] + obs.velocity[1] * k, u[2] + obs.velocity[2] * k];
  const al = length(a);
  const direction: Vec3 = [a[0] / al, a[1] / al, a[2] / al];

  const gcrs = mulMat3Vec(ECLIPTIC_TO_EQUATORIAL, direction);
  const tod = mulMat3Vec(obs.orientation.npb, gcrs);
  const [ra, dec] = cartesianToSpherical(tod);
  const itrs = mulMat3Vec(obs.orientation.gcrsToItrs, gcrs);
  const horizontal = itrsToAltAz(itrs, obs.location);
  return {
    raJ2000: astrometric[0],
    decJ2000: astrometric[1],
    ra,
    dec,
    horizontal,
    altRefracted: horizontal.alt + refraction(horizontal.alt),
    distanceKm: dist,
    direction,
    lightTimeDays,
  };
}

/** Observer → body vector at emission time (light-time iterated), km. */
export function lightTimeVector(eph: Ephemeris, obs: ObserverState, id: SolarBodyId, out: Vec3 = [0, 0, 0]): number {
  let tau = 0;
  const p: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    eph.barycentric(id, obs.time.jdTdb - tau, p);
    out[0] = p[0] - obs.position[0];
    out[1] = p[1] - obs.position[1];
    out[2] = p[2] - obs.position[2];
    tau = length(out) / C_KM_PER_DAY;
  }
  return tau;
}

export function apparentBody(eph: Ephemeris, obs: ObserverState, id: SolarBodyId): ApparentPlace {
  const P: Vec3 = [0, 0, 0];
  const tau = lightTimeVector(eph, obs, id, P);
  return apparentFromVector(obs, P, tau);
}

/** Apparent place of a fixed object (star) at a barycentric position, km, ecliptic J2000. */
export function apparentFixed(obs: ObserverState, positionKm: Readonly<Vec3>): ApparentPlace {
  return apparentFromVector(obs, [
    positionKm[0] - obs.position[0],
    positionKm[1] - obs.position[1],
    positionKm[2] - obs.position[2],
  ]);
}
