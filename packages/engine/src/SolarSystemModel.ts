/** Solar-system bodies as frames in the FrameGraph, plus per-body orientation. */

import {
  AU, type BodyInfo, type Mat3, type PlanetId, PLANET_IDS, SOLAR_SYSTEM, bodyToEclipticMatrix,
  centuriesSinceJ2000, moonGeocentricEcliptic, planetHeliocentric, type AstroTime,
} from '@simuverse/astro';
import type { Frame, FrameGraph } from './frames.ts';

export const SUN_FRAME_ID = 'sun';

export interface BodyState {
  info: BodyInfo;
  frame: Frame;
  /** Body-fixed → ecliptic J2000 rotation (row-major), updated each frame. */
  orientation: Mat3;
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export class SolarSystemModel {
  readonly bodies = new Map<string, BodyState>();

  constructor(frames: FrameGraph) {
    // The Sun is the root for now; the barycentre offset (< 0.01 AU) arrives with DE440 fits.
    const sunFrame = frames.add(SUN_FRAME_ID, frames.root.id, (_t, o) => { o[0] = 0; o[1] = 0; o[2] = 0; });
    for (const info of SOLAR_SYSTEM) {
      let frame: Frame;
      if (info.id === 'sun') frame = sunFrame;
      else if (info.id === 'moon') {
        frame = frames.add('moon', 'earth', (t, o) => {
          moonGeocentricEcliptic(centuriesSinceJ2000(t.jdTdb), o);
          o[0] *= AU; o[1] *= AU; o[2] *= AU;
        });
      } else if ((PLANET_IDS as readonly string[]).includes(info.id)) {
        const id = info.id as PlanetId;
        frame = frames.add(id, SUN_FRAME_ID, (t, o) => {
          planetHeliocentric(id, centuriesSinceJ2000(t.jdTdb), o);
          o[0] *= AU; o[1] *= AU; o[2] *= AU;
        });
      } else continue;
      this.bodies.set(info.id, { info, frame, orientation: [...IDENTITY] as Mat3 });
    }
  }

  update(t: AstroTime): void {
    for (const b of this.bodies.values()) {
      const m = bodyToEclipticMatrix(b.info.id, t.jdTdb);
      if (m) b.orientation = m;
    }
  }

  get(id: string): BodyState | undefined {
    return this.bodies.get(id);
  }
}
