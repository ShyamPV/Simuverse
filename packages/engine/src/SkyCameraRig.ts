/**
 * Observer camera standing on Earth's surface. Its position is re-derived each
 * frame from the observer's geodetic location and Earth's orientation, so the
 * sky turns as the Earth does. View direction is held as azimuth/altitude in
 * the local horizon frame; zoom changes the field of view.
 */

import {
  type EarthOrientation, type GeodeticLocation, type Vec3, enuBasis, geodeticToItrs, mulMat3Vec,
} from '@simuverse/astro';
import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { CameraRig } from './CameraRig.ts';
import type { Frame } from './frames.ts';

export const SKY_MIN_FOV = 0.02; // ~72″: enough to resolve planetary discs and Saturn's rings
export const SKY_MAX_FOV = 100;
const EYE_HEIGHT_M = 1.7;
const MAX_ALT = MathUtils.degToRad(89.9);

/** Local horizon basis in world (ecliptic J2000) axes. */
export interface HorizonBasis {
  east: Vec3;
  north: Vec3;
  up: Vec3;
}

export class SkyCameraRig implements CameraRig {
  readonly offset: Vec3 = [0, 0, 0];
  readonly quaternion = new Quaternion();
  readonly basis: HorizonBasis = { east: [1, 0, 0], north: [0, 1, 0], up: [0, 0, 1] };
  readonly focusId = 'earth';
  readonly focusDistance = 0;
  readonly altitude = EYE_HEIGHT_M;

  az = Math.PI;
  alt = MathUtils.degToRad(25);
  fovDeg = 60;
  private goalAz = this.az;
  private goalAlt = this.alt;
  private goalLogFov = Math.log(this.fovDeg);
  /** Accumulated zoom-out pressure at maximum field of view (triggers lift-off). */
  private pressure = 0;
  private turn: { fromAz: number; fromAlt: number; t: number; duration: number } | null = null;

  private readonly m4 = new Matrix4();
  private readonly fwd = new Vector3();
  private readonly up = new Vector3();
  private readonly origin = new Vector3();

  constructor(
    readonly anchor: Frame,
    public location: GeodeticLocation,
    private reducedMotion = false,
    /** Called once when the user keeps zooming out past the widest field of view. */
    private readonly onLiftOff?: () => void,
  ) {}

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
  }

  setLocation(loc: GeodeticLocation): void {
    this.location = loc;
  }

  /** Pans by screen-proportional amounts (radians at the current FOV are applied by the caller). */
  panBy(dAz: number, dAlt: number): void {
    this.turn = null;
    this.goalAz += dAz;
    this.goalAlt = MathUtils.clamp(this.goalAlt + dAlt, -MAX_ALT, MAX_ALT);
  }

  zoomBy(amount: number): void {
    const next = this.goalLogFov + amount;
    if (amount > 0 && next >= Math.log(SKY_MAX_FOV)) {
      this.pressure += amount;
      if (this.pressure > 1.2) {
        this.pressure = 0;
        this.onLiftOff?.();
      }
    } else {
      this.pressure = 0;
    }
    this.goalLogFov = MathUtils.clamp(next, Math.log(SKY_MIN_FOV), Math.log(SKY_MAX_FOV));
  }

  setFov(deg: number): void {
    this.goalLogFov = Math.log(MathUtils.clamp(deg, SKY_MIN_FOV, SKY_MAX_FOV));
  }

  /** Smoothly turns to face the given horizontal direction. */
  lookAt(az: number, alt: number, instant = false): void {
    // Take the short way round in azimuth.
    let target = az;
    while (target - this.az > Math.PI) target -= 2 * Math.PI;
    while (target - this.az < -Math.PI) target += 2 * Math.PI;
    this.goalAz = target;
    this.goalAlt = MathUtils.clamp(alt, -MAX_ALT, MAX_ALT);
    if (instant || this.reducedMotion) {
      this.az = this.goalAz;
      this.alt = this.goalAlt;
      this.turn = null;
    } else {
      this.turn = { fromAz: this.az, fromAlt: this.alt, t: 0, duration: 1.1 };
    }
  }

  /** Recomputes position and horizon basis for the current Earth orientation. */
  place(orientation: EarthOrientation): void {
    const itrs = geodeticToItrs({ ...this.location, height: this.location.height + EYE_HEIGHT_M });
    const world = mulMat3Vec(orientation.itrsToEcliptic, itrs);
    this.offset[0] = world[0] * 1000;
    this.offset[1] = world[1] * 1000;
    this.offset[2] = world[2] * 1000;
    const enu = enuBasis(this.location);
    this.basis.east = mulMat3Vec(orientation.itrsToEcliptic, enu.east);
    this.basis.north = mulMat3Vec(orientation.itrsToEcliptic, enu.north);
    this.basis.up = mulMat3Vec(orientation.itrsToEcliptic, enu.up);
  }

  /** World direction for a horizontal (az from north through east, alt) pair. */
  directionFor(az: number, alt: number, out: Vec3 = [0, 0, 0]): Vec3 {
    const { east, north, up } = this.basis;
    const ca = Math.cos(alt), e = ca * Math.sin(az), n = ca * Math.cos(az), u = Math.sin(alt);
    out[0] = e * east[0] + n * north[0] + u * up[0];
    out[1] = e * east[1] + n * north[1] + u * up[1];
    out[2] = e * east[2] + n * north[2] + u * up[2];
    return out;
  }

  /** Horizontal coordinates of a world direction. */
  horizontalOf(dir: Readonly<Vec3>): { az: number; alt: number } {
    const { east, north, up } = this.basis;
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const e = (dir[0] * east[0] + dir[1] * east[1] + dir[2] * east[2]) / l;
    const n = (dir[0] * north[0] + dir[1] * north[1] + dir[2] * north[2]) / l;
    const u = (dir[0] * up[0] + dir[1] * up[1] + dir[2] * up[2]) / l;
    return { az: (Math.atan2(e, n) + 2 * Math.PI) % (2 * Math.PI), alt: Math.asin(MathUtils.clamp(u, -1, 1)) };
  }

  update(dt: number): void {
    if (this.turn) {
      this.turn.t += dt;
      const s = MathUtils.smootherstep(this.turn.t / this.turn.duration, 0, 1);
      this.az = this.turn.fromAz + (this.goalAz - this.turn.fromAz) * s;
      this.alt = this.turn.fromAlt + (this.goalAlt - this.turn.fromAlt) * s;
      if (this.turn.t >= this.turn.duration) this.turn = null;
    } else {
      const k = 1 - Math.exp(-dt * (this.reducedMotion ? 40 : 14));
      this.az += (this.goalAz - this.az) * k;
      this.alt += (this.goalAlt - this.alt) * k;
    }
    const kf = 1 - Math.exp(-dt * (this.reducedMotion ? 40 : 10));
    this.fovDeg = Math.exp(Math.log(this.fovDeg) + (this.goalLogFov - Math.log(this.fovDeg)) * kf);

    const d = this.directionFor(this.az, this.alt);
    this.fwd.set(d[0], d[1], d[2]);
    const u = this.basis.up;
    this.up.set(u[0], u[1], u[2]);
    // Matrix4.lookAt builds a basis whose −Z looks from eye to target.
    this.m4.lookAt(this.origin, this.fwd, this.up);
    this.quaternion.setFromRotationMatrix(this.m4);
  }
}
