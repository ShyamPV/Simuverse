/**
 * Free-flight camera: WASD to move, Q/E down/up, drag to look, Shift to boost,
 * wheel to change the speed factor. Like the orbit camera it is stored as
 * (anchor frame, float64 offset); the engine re-anchors it to whatever body
 * the camera is near so precision follows you around.
 *
 * Speed is proportional to the distance to the nearest object (set by the
 * engine as `reference`), so the same keys cross a room-sized gap next to an
 * asteroid and a megaparsec between galaxies, and a single step can never
 * carry you through the nearest surface.
 */

import type { Vec3 } from '@simuverse/astro';
import { MathUtils, Quaternion, Vector3 } from 'three';
import type { CameraRig } from './CameraRig.ts';
import type { Frame, FrameGraph } from './frames.ts';

const MIN_FACTOR = 1 / 64;
const MAX_FACTOR = 64;
/** Fraction of the reference distance covered per second at factor 1. */
const BASE_RATE = 0.5;
const BOOST = 6;

const MOVE_KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, 0, -1], KeyS: [0, 0, 1], KeyA: [-1, 0, 0], KeyD: [1, 0, 0], KeyE: [0, 1, 0], KeyQ: [0, -1, 0],
};

export class FlyCameraRig implements CameraRig {
  anchor: Frame;
  readonly offset: Vec3 = [0, 0, 0];
  readonly quaternion = new Quaternion();
  readonly fovDeg = 60;
  focusId = '';
  /** Distance to the nearest object's surface, metres (set by the engine each frame). */
  reference = 1e7;
  /** User speed multiplier (wheel). */
  factor = 1;

  private readonly keys = new Set<string>();
  private readonly velocity = new Vector3();
  private readonly v = new Vector3();
  private readonly q = new Quaternion();
  private readonly axis = new Vector3();
  private lookYaw = 0;
  private lookPitch = 0;

  constructor(anchor: Frame, private reducedMotion = false) {
    this.anchor = anchor;
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
  }

  get focusDistance(): number {
    return this.reference;
  }

  get altitude(): number {
    return this.reference;
  }

  /** Current speed, m/s. */
  get speed(): number {
    return this.velocity.length();
  }

  get moving(): boolean {
    return this.keys.size > 0 || this.velocity.lengthSq() > 0;
  }

  /** Starts from another camera's pose. */
  takeOver(anchor: Frame, offset: Readonly<Vec3>, quaternion: Quaternion): void {
    this.anchor = anchor;
    this.offset[0] = offset[0]; this.offset[1] = offset[1]; this.offset[2] = offset[2];
    this.quaternion.copy(quaternion);
    this.velocity.set(0, 0, 0);
    this.keys.clear();
  }

  /** Re-expresses the position in another frame (same place in space). */
  reanchor(frame: Frame, frames: FrameGraph): void {
    if (frame === this.anchor) return;
    const d = frames.difference(frame, [0, 0, 0], this.anchor, this.offset);
    this.anchor = frame;
    this.offset[0] = d[0]; this.offset[1] = d[1]; this.offset[2] = d[2];
  }

  /** Turns the view; yaw about the camera's up axis, pitch about its right axis (radians). */
  look(yaw: number, pitch: number): void {
    this.lookYaw += yaw;
    this.lookPitch += pitch;
  }

  /** Returns true if the key is a flight control (so the caller can claim it). */
  key(code: string, down: boolean): boolean {
    if (!(code in MOVE_KEYS) && code !== 'ShiftLeft' && code !== 'ShiftRight') return false;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    return code in MOVE_KEYS;
  }

  releaseKeys(): void {
    this.keys.clear();
  }

  scaleSpeed(steps: number): void {
    this.factor = MathUtils.clamp(this.factor * 1.25 ** steps, MIN_FACTOR, MAX_FACTOR);
  }

  update(dt: number): void {
    // Look: apply the accumulated mouse/key turn in the camera's own axes.
    if (this.lookYaw || this.lookPitch) {
      this.q.setFromAxisAngle(this.axis.set(0, 1, 0), this.lookYaw);
      this.quaternion.multiply(this.q);
      this.q.setFromAxisAngle(this.axis.set(1, 0, 0), this.lookPitch);
      this.quaternion.multiply(this.q).normalize();
      this.lookYaw = this.lookPitch = 0;
    }
    const dir = this.v.set(0, 0, 0);
    for (const k of this.keys) {
      const m = MOVE_KEYS[k];
      if (m) dir.x += m[0], dir.y += m[1], dir.z += m[2];
    }
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? BOOST : 1;
    const speed = Math.max(this.reference, 1) * BASE_RATE * this.factor * boost;
    if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(speed).applyQuaternion(this.quaternion);
    // Ease towards the commanded velocity (instantly with reduced motion).
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 5);
    this.velocity.lerp(dir, k);
    if (this.velocity.lengthSq() < 1e-6 && dir.lengthSq() === 0) this.velocity.set(0, 0, 0);
    // Never move further in one frame than half the gap to the nearest surface.
    let step = this.velocity.length() * dt;
    const maxStep = Math.max(this.reference, 1) * 0.5;
    if (step > maxStep) step = maxStep;
    if (step > 0) {
      const n = this.v.copy(this.velocity).normalize();
      this.offset[0] += n.x * step;
      this.offset[1] += n.y * step;
      this.offset[2] += n.z * step;
    }
  }
}
