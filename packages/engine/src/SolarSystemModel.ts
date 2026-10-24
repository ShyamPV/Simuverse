/**
 * Solar-system bodies as frames in the FrameGraph, driven by the DE440
 * Chebyshev ephemeris (falling back to Keplerian elements outside 1900–2100),
 * plus per-body orientation. The graph root is the solar-system barycentre.
 */

import {
  type AstroTime, type BodyInfo, type EarthOrientation, type Ephemeris, type Mat3, SOLAR_SYSTEM, type SolarBodyId,
  bodyToEclipticMatrix, earthOrientation,
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
  }

  update(t: AstroTime): void {
    this.precise = this.ephemeris.isPrecise(t.jdTdb);
    this.earth = earthOrientation(t.jdTt, t.jdUt1);
    for (const b of this.bodies.values()) {
      if (b.info.id === 'earth') {
        b.orientation = this.earth.itrsToEcliptic;
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
