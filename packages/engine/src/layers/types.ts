import type { AstroTime, Ephemeris, ObserverState, Vec3 } from '@simuverse/astro';
import type { Object3D, PerspectiveCamera } from 'three';
import type { CameraRig } from '../CameraRig.ts';
import type { Frame, FrameGraph } from '../frames.ts';
import type { SkyCameraRig } from '../SkyCameraRig.ts';

export type ViewMode = 'universe' | 'sky';

/** Extra per-frame state available while standing on Earth. */
export interface SkyContext {
  rig: SkyCameraRig;
  observer: ObserverState;
  /** Observer barycentric velocity in units of c, world axes (for aberration). */
  velocityC: Vec3;
  /** Geometric altitude of the Sun, radians. */
  sunAlt: number;
  /** Apparent Sun direction in the local east/north/up frame (unit). */
  sunLocal: Vec3;
  /** Faintest magnitude visible against the current sky. */
  limitMag: number;
  /** Draw the opaque ground below the horizon. */
  ground: boolean;
  /** Atmosphere (sky glow, extinction) enabled. */
  atmosphere: boolean;
}

/**
 * Auto-exposure. As the camera leaves the Galaxy, point sources would vanish
 * under a fixed exposure, so the effective magnitude scale shifts by
 * `pointMag` (applied to star/galaxy point photometry). Extended objects get a
 * much gentler `extendedGain` so resolved galaxies don't wash out.
 */
export interface Exposure {
  pointMag: number;
  extendedGain: number;
  /** Galaxies beyond this distance from the camera (Mpc) fade out (scale-dependent depth fog). */
  fogMpc: number;
}

export interface RenderContext {
  time: AstroTime;
  frames: FrameGraph;
  ephemeris: Ephemeris;
  rig: CameraRig;
  mode: ViewMode;
  /** Present only in Sky mode. */
  sky: SkyContext | null;
  camera: PerspectiveCamera;
  exposure: Exposure;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  pixelRatio: number;
  /** CSS pixels per radian at the centre of the view. */
  pixelsPerRadian: number;
  /** Vector from the camera to a point (frame + local offset), metres, world axes. */
  toCamera(frame: Frame, local: Readonly<Vec3>, out: Vec3): Vec3;
}

export interface Layer {
  readonly object: Object3D;
  update(ctx: RenderContext): void;
  dispose(): void;
}
