import type { Vec3 } from '@simuverse/astro';
import type { Quaternion } from 'three';
import type { Frame } from './frames.ts';

/** Common surface of the orbit (Universe) and observer (Sky) cameras. */
export interface CameraRig {
  /** Frame the camera position is expressed in. */
  readonly anchor: Frame;
  /** Camera position in the anchor frame, metres (float64). */
  readonly offset: Vec3;
  /** World-space orientation (ecliptic J2000 axes). */
  readonly quaternion: Quaternion;
  /** Vertical field of view, degrees. */
  readonly fovDeg: number;
  /** Id of the object the camera is centred on, if any. */
  readonly focusId: string;
  /** Distance to the focus centre, metres (used for orbit fades and scale bars). */
  readonly focusDistance: number;
  /** Height above the nearest surface, metres (drives the near plane). */
  readonly altitude: number;
  update(dt: number): void;
}
