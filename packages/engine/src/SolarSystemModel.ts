/**
 * Solar-system bodies as frames in the FrameGraph, driven by the DE440
 * Chebyshev ephemeris (falling back to Keplerian elements outside 1900–2100),
 * plus per-body orientation. The graph root is the solar-system barycentre.
 * The major moons of Mars and the outer planets hang off their planets'
 * frames, positioned from fitted mean elements and tidally locked.
 */

import {
  type AstroTime, type BodyInfo, type EarthOrientation, type Ephemeris, MOONS, type Mat3, SOLAR_SYSTEM, type SolarBodyId,
  type Vec3, bodyToEclipticMatrix, earthOrientation, isFittedMoon, moonPosition,
} from '@simuverse/astro';
import type { Frame, FrameGraph } from './frames.ts';

export const SUN_FRAME_ID = 'sun';
const KM = 1000;

export interface BodyState {
  info: BodyInfo;
  frame: Frame;
  /** Body-fixed → ecliptic J2000 rotation (row-major), updated each frame. */
  orientation: Mat3;
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export class SolarSystemModel {
  readonly bodies = new Map<string, BodyState>();
  /** Earth orientation for the current frame (precession–nutation + sidereal time). */
  earth!: EarthOrientation;
  /** False while the current date is served by fallback models. */
  precise = false;

  constructor(frames: FrameGraph, readonly ephemeris: Ephemeris) {
    const origin = (id: SolarBodyId) => (t: AstroTime, o: [number, number, number]) => {
      ephemeris.relative(id, t.jdTdb, o);
      o[0] *= KM; o[1] *= KM; o[2] *= KM;
    };
    for (const info of SOLAR_SYSTEM) {
      const id = info.id as SolarBodyId;
      const parent = info.id === 'sun' ? frames.root.id : info.parent!;
      const frame = frames.add(info.id, parent, origin(id));
      this.bodies.set(info.id, { info, frame, orientation: [...IDENTITY] as Mat3 });
    }
    for (const info of MOONS) {
      const frame = frames.add(info.id, info.parent!, (t, o) => {
        moonPosition(info.id, t.jdTdb, o);
        o[0] *= KM; o[1] *= KM; o[2] *= KM;
      });
      this.bodies.set(info.id, { info, frame, orientation: [...IDENTITY] as Mat3 });
    }
  }

  update(t: AstroTime): void {
    this.precise = this.ephemeris.isPrecise(t.jdTdb);
    this.earth = earthOrientation(t.jdTt, t.jdUt1);
    for (const b of this.bodies.values()) {
      if (b.info.id === 'earth') {
        b.orientation = this.earth.itrsToEcliptic;
        continue;
      }
      if (isFittedMoon(b.info.id)) {
        b.orientation = lockedOrientation(b.info.id, b.frame.origin, t.jdTdb);
        continue;
      }
      const m = bodyToEclipticMatrix(b.info.id, t.jdTdb);
      if (m) b.orientation = m;
    }
  }

  get(id: string): BodyState | undefined {
    return this.bodies.get(id);
  }
}

/** Synchronous rotation: body x axis towards the planet, z along the orbit normal. */
function lockedOrientation(id: string, r: Readonly<Vec3>, jdTdb: number): Mat3 {
  const ahead = moonPosition(id, jdTdb + 0.001);
  const v: Vec3 = [ahead[0] * KM - r[0], ahead[1] * KM - r[1], ahead[2] * KM - r[2]];
  const rl = Math.hypot(r[0], r[1], r[2]);
  const x: Vec3 = [-r[0] / rl, -r[1] / rl, -r[2] / rl];
  const h: Vec3 = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const hl = Math.hypot(h[0], h[1], h[2]);
  const z: Vec3 = [h[0] / hl, h[1] / hl, h[2] / hl];
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  // Columns are the body axes in ecliptic coordinates (body-fixed → ecliptic).
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}
