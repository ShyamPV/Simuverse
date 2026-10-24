import type { AstroTime, Vec3 } from '@simuverse/astro';
import type { Object3D, PerspectiveCamera } from 'three';
import type { Frame, FrameGraph } from '../frames.ts';
import type { OrbitCameraRig } from '../OrbitCameraRig.ts';

export interface RenderContext {
  time: AstroTime;
  frames: FrameGraph;
  rig: OrbitCameraRig;
  camera: PerspectiveCamera;
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
