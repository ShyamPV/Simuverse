/**
 * Orbit camera around a focused body. The camera's position is stored as
 * (anchor frame, float64 offset) — never as a single global coordinate — and
 * the GPU camera always sits at the origin (camera-relative rendering).
 *
 * Zoom acts on log(altitude above the surface), so one wheel notch is the
 * same fraction of the distance whether you are 10 km or 10 kpc away.
 */

import { type Vec3, length } from '@simuverse/astro';
import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { CameraRig } from './CameraRig.ts';
import type { Frame, FrameGraph } from './frames.ts';

export interface OrbitTarget {
  id: string;
  frame: Frame;
  /** Radius used for altitude-based zoom (metres); 0 for point-like targets. */
  radius: number;
}

/** ~3× the comoving radius of the observable universe. */
export const MAX_DISTANCE = 1.5e27;
const MAX_ELEVATION = MathUtils.degToRad(89.5);
const UP = new Vector3(0, 0, 1);
const ORIGIN = new Vector3();

export class OrbitCameraRig implements CameraRig {
  anchor: Frame;
  readonly offset: Vec3 = [0, 0, 0];
  readonly quaternion = new Quaternion();
  readonly fovDeg = 50;
  target: OrbitTarget;

  private az = 0;
  private el = 0.3;
  private logAlt: number;
  private goalAz = 0;
  private goalEl = 0.3;
  private goalLogAlt: number;
  private look: { from: Quaternion; t: number; duration: number } | null = null;

  private readonly m4 = new Matrix4();
  private readonly eye = new Vector3();
  private readonly lookQ = new Quaternion();

  constructor(
    private readonly frames: FrameGraph,
    target: OrbitTarget,
    initialDistance: number,
    private reducedMotion = false,
  ) {
    this.target = target;
    this.anchor = target.frame;
    this.logAlt = this.goalLogAlt = Math.log(Math.max(initialDistance - target.radius, this.minAltitude()));
    this.apply();
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
  }

  get distance(): number {
    return this.target.radius + Math.exp(this.logAlt);
  }

  get focusId(): string {
    return this.target.id;
  }

  get focusDistance(): number {
    return this.distance;
  }

  get altitude(): number {
    return Math.exp(this.logAlt);
  }

  setAngles(az: number, el: number): void {
    this.az = this.goalAz = az;
    this.el = this.goalEl = MathUtils.clamp(el, -MAX_ELEVATION, MAX_ELEVATION);
    this.apply();
  }

  private minAltitude(): number {
    return Math.max(this.target.radius * 1e-3, 10);
  }

  /** Multiplies the distance to the surface by exp(amount). */
  zoomBy(amount: number): void {
    this.goalLogAlt = MathUtils.clamp(
      this.goalLogAlt + amount,
      Math.log(this.minAltitude()),
      Math.log(MAX_DISTANCE),
    );
  }

  zoomToDistance(distance: number): void {
    this.goalLogAlt = MathUtils.clamp(
      Math.log(Math.max(distance - this.target.radius, this.minAltitude())),
      Math.log(this.minAltitude()),
      Math.log(MAX_DISTANCE),
    );
  }

  /** Rotates around the target; dx/dy in radians at "full" sensitivity. */
  rotateBy(dAz: number, dEl: number): void {
    // Slow rotation down near the surface so a drag moves the ground predictably.
    const k = MathUtils.clamp(this.altitude / Math.max(this.target.radius, 1), 0.02, 1);
    this.goalAz += dAz * k;
    this.goalEl = MathUtils.clamp(this.goalEl + dEl * k, -MAX_ELEVATION, MAX_ELEVATION);
  }

  /**
   * Re-centres on a new target without moving the camera, then turns to face
   * it and travels to `viewDistance` along a log-distance ease.
   */
  focus(target: OrbitTarget, viewDistance: number): void {
    this.takeOver(target, this.anchor, this.offset, this.quaternion, viewDistance, 'approach');
  }

  /**
   * Like focus(), but starting from an arbitrary camera pose — used when
   * lifting off from Sky view so the transition is continuous. 'approach'
   * never moves the camera further away; 'exact' travels to viewDistance.
   */
  takeOver(
    target: OrbitTarget, fromFrame: Frame, fromOffset: Readonly<Vec3>, fromQuat: Quaternion, viewDistance: number,
    mode: 'approach' | 'exact' = 'exact',
  ): void {
    const rel = this.frames.difference(target.frame, [0, 0, 0], fromFrame, fromOffset);
    const d = Math.max(length(rel), target.radius + 1);
    this.target = target;
    this.anchor = target.frame;
    this.az = this.goalAz = Math.atan2(rel[1], rel[0]);
    this.el = this.goalEl = MathUtils.clamp(Math.asin(rel[2] / d), -MAX_ELEVATION, MAX_ELEVATION);
    this.logAlt = Math.log(Math.max(d - target.radius, this.minAltitude()));
    this.zoomToDistance(mode === 'approach' ? Math.min(viewDistance, d) : viewDistance);
    this.look = { from: fromQuat.clone(), t: 0, duration: this.reducedMotion ? 0.001 : 0.9 };
    this.apply();
  }

  /**
   * Switches the orbit centre without moving the camera, keeping any zoom
   * already in progress (used by the scale ladder while the wheel is turning).
   */
  retarget(target: OrbitTarget): void {
    const pending = this.goalLogAlt - this.logAlt;
    this.takeOver(target, this.anchor, this.offset, this.quaternion, 1, 'exact');
    const d = length(this.frames.difference(target.frame, [0, 0, 0], this.anchor, this.offset));
    this.logAlt = Math.log(Math.max(d - target.radius, this.minAltitude()));
    this.goalLogAlt = MathUtils.clamp(this.logAlt + pending, Math.log(this.minAltitude()), Math.log(MAX_DISTANCE));
  }

  /** Smoothly swings the camera to look at the target from a world direction (unit vector from target to camera). */
  viewFrom(dir: Readonly<Vec3>): void {
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const az = Math.atan2(dir[1], dir[0]);
    // Take the short way round.
    let target = az;
    while (target - this.goalAz > Math.PI) target -= 2 * Math.PI;
    while (target - this.goalAz < -Math.PI) target += 2 * Math.PI;
    this.goalAz = target;
    this.goalEl = MathUtils.clamp(Math.asin(dir[2] / l), -MAX_ELEVATION, MAX_ELEVATION);
  }

  update(dt: number): void {
    const rate = this.reducedMotion ? 30 : 7;
    const k = 1 - Math.exp(-dt * rate);
    this.az += (this.goalAz - this.az) * k;
    this.el += (this.goalEl - this.el) * k;
    const lookHalfDone = !this.look || this.look.t / this.look.duration > 0.4;
    if (lookHalfDone) {
      // Travel speed is proportional to distance: constant in log space.
      const travel = 1 - Math.exp(-dt * (this.reducedMotion ? 30 : 4));
      this.logAlt += (this.goalLogAlt - this.logAlt) * travel;
    }
    if (this.look) {
      this.look.t += dt;
      if (this.look.t >= this.look.duration) this.look = null;
    }
    this.apply();
  }

  private apply(): void {
    const d = this.distance;
    const ce = Math.cos(this.el);
    this.offset[0] = d * ce * Math.cos(this.az);
    this.offset[1] = d * ce * Math.sin(this.az);
    this.offset[2] = d * Math.sin(this.el);
    // Orientation only depends on the direction, so normalise before handing to float math.
    this.eye.set(this.offset[0] / d, this.offset[1] / d, this.offset[2] / d);
    this.m4.lookAt(this.eye, ORIGIN, UP);
    this.lookQ.setFromRotationMatrix(this.m4);
    if (this.look) {
      const s = MathUtils.smootherstep(this.look.t / this.look.duration, 0, 1);
      this.quaternion.slerpQuaternions(this.look.from, this.lookQ, s);
    } else {
      this.quaternion.copy(this.lookQ);
    }
  }
}
