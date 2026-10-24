/**
 * Solar-system positions: DE440 Chebyshev series where loaded (1900–2100),
 * otherwise the Keplerian / low-precision models. All results are km in
 * ecliptic J2000 axes.
 */

import { type EphemerisBodyId, EphemerisStore } from './chebyshev.ts';
import { moonGeocentricEcliptic } from './moon.ts';
import { EARTH_MOON_MASS_RATIO, type KeplerBodyId, planetHeliocentric } from './planets.ts';
import { centuriesSinceJ2000 } from './time.ts';
import { AU, C_MPS, DAY_S } from './units.ts';
import type { Vec3 } from './vec.ts';

export type SolarBodyId = 'sun' | KeplerBodyId | 'moon';

export const AU_KM = AU / 1000;
/** Speed of light in km/day. */
export const C_KM_PER_DAY = (C_MPS / 1000) * DAY_S;

/** Which centre each body's `relative()` position is measured from. */
export const BODY_CENTER: Record<SolarBodyId, SolarBodyId | 'ssb'> = {
  sun: 'ssb', mercury: 'sun', venus: 'sun', earth: 'sun', mars: 'sun', jupiter: 'sun', saturn: 'sun',
  uranus: 'sun', neptune: 'sun', pluto: 'sun', moon: 'earth',
};

const MOON_FRACTION = 1 / (1 + EARTH_MOON_MASS_RATIO);

export class Ephemeris {
  private readonly a: Vec3 = [0, 0, 0];
  private readonly b: Vec3 = [0, 0, 0];

  constructor(readonly store: EphemerisStore = new EphemerisStore()) {}

  /** True if DE440 data covers this date (otherwise results are approximate). */
  isPrecise(jdTdb: number): boolean {
    return this.store.covers(jdTdb);
  }

  /**
   * Position relative to BODY_CENTER[id], km. Returns true when the DE440
   * series was used, false when the fallback model was.
   */
  relative(id: SolarBodyId, jdTdb: number, out: Vec3): boolean {
    const s = this.store;
    switch (id) {
      case 'sun':
        if (s.position('sun', jdTdb, out)) return true;
        out[0] = out[1] = out[2] = 0; // fallback: Sun at the barycentre (< 0.01 AU error)
        return false;
      case 'moon':
        if (s.position('moon', jdTdb, out)) return true;
        moonGeocentricEcliptic(centuriesSinceJ2000(jdTdb), out);
        scaleInPlace(out, AU_KM);
        return false;
      case 'earth': {
        const moon = this.a;
        if (s.position('emb', jdTdb, out) && s.position('moon', jdTdb, moon)) {
          out[0] -= moon[0] * MOON_FRACTION;
          out[1] -= moon[1] * MOON_FRACTION;
          out[2] -= moon[2] * MOON_FRACTION;
          return true;
        }
        planetHeliocentric('earth', centuriesSinceJ2000(jdTdb), out);
        scaleInPlace(out, AU_KM);
        return false;
      }
      default:
        if (s.position(id as EphemerisBodyId, jdTdb, out)) return true;
        planetHeliocentric(id, centuriesSinceJ2000(jdTdb), out);
        scaleInPlace(out, AU_KM);
        return false;
    }
  }

  /** Position relative to the solar-system barycentre, km. */
  barycentric(id: SolarBodyId, jdTdb: number, out: Vec3): boolean {
    let precise = this.relative(id, jdTdb, out);
    let center = BODY_CENTER[id];
    const tmp = this.b;
    while (center !== 'ssb') {
      precise = this.relative(center, jdTdb, tmp) && precise;
      out[0] += tmp[0];
      out[1] += tmp[1];
      out[2] += tmp[2];
      center = BODY_CENTER[center];
    }
    return precise;
  }

  /** Barycentric velocity, km/day (central difference over ±30 min). */
  barycentricVelocity(id: SolarBodyId, jdTdb: number, out: Vec3): Vec3 {
    const h = 1 / 48;
    const p1: Vec3 = [0, 0, 0], p2: Vec3 = [0, 0, 0];
    this.barycentric(id, jdTdb + h, p1);
    this.barycentric(id, jdTdb - h, p2);
    out[0] = (p1[0] - p2[0]) / (2 * h);
    out[1] = (p1[1] - p2[1]) / (2 * h);
    out[2] = (p1[2] - p2[2]) / (2 * h);
    return out;
  }
}

function scaleInPlace(v: Vec3, s: number): void {
  v[0] *= s;
  v[1] *= s;
  v[2] *= s;
}
