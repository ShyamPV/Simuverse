/**
 * Orbit camera around a focused body. The camera's position is stored as
 * (anchor frame, float64 offset) — never as a single global coordinate — and
 * the GPU camera always sits at the origin (camera-relative rendering).
 *
 * Zoom acts on log(altitude above the surface), so one wheel notch is the
 * same fraction of the distance whether you are 10 km or 10 kpc away.
 *
 * Warps (travel to a new target) follow a timed ease in log(altitude): the
 * speed builds up, peaks mid-way (orders of magnitude faster than light on
 * long trips) and settles, taking 1–7 s from a planet hop to a trip across
 * the observable universe. Near the end the camera swings round to the
 * arrival viewpoint.
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
  private travel: {
    from: number; to: number; t: number; duration: number;
    swing: { az0: number; el0: number; az1: number; el1: number } | null;
  } | null = null;

  /** Wall-clock time of the last update, so timed warps keep their duration on slow machines. */
  private lastUpdateMs = 0;

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

  /** Direction from the target to the camera: azimuth and elevation in ecliptic axes, radians. */
  get azimuth(): number {
    return this.az;
  }

  get elevation(): number {
    return this.el;
  }

  /** Puts the camera at a given direction and distance from a target, instantly. */
  place(target: OrbitTarget, az: number, el: number, distance: number): void {
    this.travel = null;
    this.look = null;
    this.target = target;
    this.anchor = target.frame;
    this.logAlt = this.goalLogAlt = MathUtils.clamp(
      Math.log(Math.max(distance - target.radius, this.minAltitude())), Math.log(this.minAltitude()), Math.log(MAX_DISTANCE),
    );
    this.setAngles(az, el);
  }

  setAngles(az: number, el: number): void {
    this.az = this.goalAz = az;
    this.el = this.goalEl = MathUtils.clamp(el, -MAX_ELEVATION, MAX_ELEVATION);
    this.apply();
  }

  private minAltitude(): number {
    return Math.max(this.target.radius * 1e-3, 10);
  }

  /** True while a warp is in progress. */
  get warping(): boolean {
    return !!this.travel;
  }

  /** Warp progress 0–1 and seconds remaining, or null when not warping. */
  get warpState(): { progress: number; remaining: number } | null {
    const t = this.travel;
    return t ? { progress: Math.min(t.t / t.duration, 1), remaining: Math.max(t.duration - t.t, 0) } : null;
  }

  /** Stops a warp where it is. */
  cancelWarp(): void {
    if (!this.travel) return;
    this.travel = null;
    this.goalLogAlt = this.logAlt;
    this.goalAz = this.az;
    this.goalEl = this.el;
  }

  /**
   * Travels to a target: turns to face it, then eases log(altitude) to
   * viewDistance over a duration that grows with the number of e-foldings
   * crossed, swinging round to view from `arrive` (unit vector from the target) on the way in.
   */
  warpTo(target: OrbitTarget, viewDistance: number, arrive: Readonly<Vec3> | null): void {
    this.travel = null;
    // The scale we leave from (height above the old target) counts too: a hop from a
    // planet to Andromeda crosses ~15 orders of magnitude even though, measured from
    // Andromeda, the distance only shrinks eightfold.
    const startLog = this.logAlt;
    this.takeOver(target, this.anchor, [...this.offset], this.quaternion, viewDistance, 'exact');
    const from = this.logAlt, to = this.goalLogAlt;
    const span = Math.abs(to - from) + Math.max(0, from - startLog);
    let swing: { az0: number; el0: number; az1: number; el1: number } | null = null;
    if (arrive) {
      const l = Math.hypot(arrive[0], arrive[1], arrive[2]) || 1;
      let az1 = Math.atan2(arrive[1], arrive[0]);
      while (az1 - this.az > Math.PI) az1 -= 2 * Math.PI;
      while (az1 - this.az < -Math.PI) az1 += 2 * Math.PI;
      swing = { az0: this.az, el0: this.el, az1, el1: MathUtils.clamp(Math.asin(arrive[2] / l), -MAX_ELEVATION, MAX_ELEVATION) };
    }
    if (span < 0.3 && !swing) return;
    const duration = this.reducedMotion ? 0.001 : MathUtils.clamp(1.2 + 0.1 * span, 1.4, 7);
    this.travel = { from, to, t: 0, duration, swing };
  }

  /** Multiplies the distance to the surface by exp(amount). */
  zoomBy(amount: number): void {
    this.cancelWarp();
    this.goalLogAlt = MathUtils.clamp(
      this.goalLogAlt + amount,
      Math.log(this.minAltitude()),
      Math.log(MAX_DISTANCE),
    );
  }

  zoomToDistance(distance: number): void {
    this.travel = null;
    this.goalLogAlt = MathUtils.clamp(
      Math.log(Math.max(distance - this.target.radius, this.minAltitude())),
      Math.log(this.minAltitude()),
      Math.log(MAX_DISTANCE),
    );
  }

  /** Rotates around the target; dx/dy in radians at "full" sensitivity. */
  rotateBy(dAz: number, dEl: number): void {
    if (this.travel) this.travel.swing = null;
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
    this.travel = null;
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
    // Warps and the turn towards a target run on real time (the frame dt is capped at 0.1 s),
    // so at a few frames per second they still take seconds, not minutes.
    const nowMs = performance.now();
    const realDt = this.lastUpdateMs ? Math.min(Math.max((nowMs - this.lastUpdateMs) / 1000, dt), 2) : dt;
    this.lastUpdateMs = nowMs;
    const lookHalfDone = !this.look || this.look.t / this.look.duration > 0.4;
    const tr = this.travel;
    if (tr && lookHalfDone) {
      tr.t += realDt;
      const s = MathUtils.smootherstep(tr.t / tr.duration, 0, 1);
      this.logAlt = this.goalLogAlt = tr.from + (tr.to - tr.from) * s;
      if (tr.swing) {
        // Swing round to the arrival viewpoint over the second half of the trip.
        const w = MathUtils.smoothstep(s, 0.35, 1);
        this.az = this.goalAz = tr.swing.az0 + (tr.swing.az1 - tr.swing.az0) * w;
        this.el = this.goalEl = tr.swing.el0 + (tr.swing.el1 - tr.swing.el0) * w;
      }
      if (tr.t >= tr.duration) this.travel = null;
    } else if (lookHalfDone) {
      // Travel speed is proportional to distance: constant in log space.
      const travel = 1 - Math.exp(-dt * (this.reducedMotion ? 30 : 4));
      this.logAlt += (this.goalLogAlt - this.logAlt) * travel;
    }
    if (this.look) {
      this.look.t += realDt;
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
