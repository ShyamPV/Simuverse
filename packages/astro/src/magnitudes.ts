/**
 * Visual magnitudes of solar-system bodies (Astronomical Almanac formulae as
 * given in Meeus, *Astronomical Algorithms* ch. 41; Moon after Allen) and the
 * Moon's phase.
 */

import { lightTimeVector, type ObserverState } from './apparent.ts';
import { AU_KM, type Ephemeris, type SolarBodyId } from './ephemeris.ts';
import { ROTATION } from './rotation.ts';
import { EQUATORIAL_TO_ECLIPTIC } from './coords.ts';
import { DEG } from './units.ts';
import { type Vec3, angleBetween, length, mulMat3Vec, sphericalToCartesian } from './vec.ts';

/**
 * Magnitude from heliocentric distance r, observer distance Δ (AU), phase angle i (degrees).
 * `ringTilt` is Saturn's ring-plane tilt towards the observer, radians.
 */
export function bodyMagnitude(id: SolarBodyId, r: number, delta: number, i: number, ringTilt = 0): number {
  const d = 5 * Math.log10(r * delta);
  switch (id) {
    case 'sun': return -26.74 + 5 * Math.log10(delta);
    case 'mercury': return -0.42 + d + 0.038 * i - 0.000273 * i * i + 0.000002 * i ** 3;
    case 'venus': return -4.4 + d + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i ** 3;
    case 'earth': return -3.87 + d + 0.0130 * i; // as seen from elsewhere
    case 'mars': return -1.52 + d + 0.016 * i;
    case 'jupiter': return -9.4 + d + 0.005 * i;
    case 'saturn': {
      const sb = Math.sin(Math.abs(ringTilt));
      return -8.88 + d + 0.044 * i - 2.6 * sb + 1.25 * sb * sb;
    }
    case 'uranus': return -7.19 + d;
    case 'neptune': return -6.87 + d;
    case 'pluto': return -1.0 + d;
    case 'moon': return 0.21 + d + 0.026 * Math.abs(i) + 4e-9 * i ** 4;
  }
}

export interface Photometry {
  magnitude: number;
  /** Sun–body–observer angle, radians. */
  phaseAngle: number;
  /** Illuminated fraction of the disc, 0–1. */
  illuminated: number;
}

/** Magnitude and phase as seen by the observer. */
export function bodyPhotometry(eph: Ephemeris, obs: ObserverState, id: SolarBodyId): Photometry {
  const toBody: Vec3 = [0, 0, 0];
  const tau = lightTimeVector(eph, obs, id, toBody);
  const delta = length(toBody);
  if (id === 'sun') return { magnitude: bodyMagnitude('sun', 1, delta / AU_KM, 0), phaseAngle: 0, illuminated: 1 };
  const body: Vec3 = [0, 0, 0], sun: Vec3 = [0, 0, 0];
  eph.barycentric(id, obs.time.jdTdb - tau, body);
  eph.barycentric('sun', obs.time.jdTdb - tau, sun);
  const fromSun: Vec3 = [body[0] - sun[0], body[1] - sun[1], body[2] - sun[2]];
  // Phase angle: between body→Sun and body→observer.
  const phase = angleBetween([-fromSun[0], -fromSun[1], -fromSun[2]], [-toBody[0], -toBody[1], -toBody[2]]);
  let ringTilt = 0;
  if (id === 'saturn') {
    const rot = ROTATION.saturn!;
    const T = (obs.time.jdTdb - 2451545) / 36525;
    const pole = mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, sphericalToCartesian(rot.ra(T) * DEG, rot.dec(T) * DEG));
    ringTilt = Math.PI / 2 - angleBetween(pole, toBody);
  }
  return {
    magnitude: bodyMagnitude(id, length(fromSun) / AU_KM, delta / AU_KM, phase / DEG, ringTilt),
    phaseAngle: phase,
    illuminated: (1 + Math.cos(phase)) / 2,
  };
}

export type MoonPhaseName =
  | 'New Moon' | 'Waxing Crescent' | 'First Quarter' | 'Waxing Gibbous'
  | 'Full Moon' | 'Waning Gibbous' | 'Last Quarter' | 'Waning Crescent';

/**
 * Moon phase from the Moon–Sun elongation in ecliptic longitude (0 = new,
 * 180° = full). Returns the age as a fraction of the synodic month too.
 */
export function moonPhase(eph: Ephemeris, obs: ObserverState): { name: MoonPhaseName; fraction: number; illuminated: number } {
  const m: Vec3 = [0, 0, 0], s: Vec3 = [0, 0, 0];
  lightTimeVector(eph, obs, 'moon', m);
  lightTimeVector(eph, obs, 'sun', s);
  let dl = Math.atan2(m[1], m[0]) - Math.atan2(s[1], s[0]);
  dl = ((dl % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const fraction = dl / (2 * Math.PI);
  const names: MoonPhaseName[] = [
    'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
  ];
  const name = names[Math.round(fraction * 8) % 8]!;
  return { name, fraction, illuminated: bodyPhotometry(eph, obs, 'moon').illuminated };
}
