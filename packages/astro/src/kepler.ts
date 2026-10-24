/** Two-body orbits from classical elements. */

import { type Vec3 } from './vec.ts';

export interface OrbitalElements {
  /** Semi-major axis (any length unit; output uses the same unit). */
  a: number;
  e: number;
  /** Inclination, radians. */
  i: number;
  /** Longitude of ascending node Ω, radians. */
  node: number;
  /** Argument of periapsis ω, radians. */
  argPeri: number;
  /** Mean anomaly M, radians. */
  M: number;
}

/** Solves Kepler's equation M = E − e sin E for elliptical orbits (e < 1). */
export function solveKepler(M: number, e: number, tol = 1e-14): number {
  let m = M % (2 * Math.PI);
  if (m > Math.PI) m -= 2 * Math.PI;
  else if (m < -Math.PI) m += 2 * Math.PI;
  let E = e < 0.8 ? m : Math.PI * Math.sign(m || 1);
  for (let k = 0; k < 50; k++) {
    const f = E - e * Math.sin(E) - m;
    const dE = f / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < tol) break;
  }
  return E;
}

/** Position in the reference plane frame (x → reference direction) from elements. */
export function elementsToPosition(el: OrbitalElements, out: Vec3 = [0, 0, 0]): Vec3 {
  const E = solveKepler(el.M, el.e);
  const xp = el.a * (Math.cos(E) - el.e);
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  return orbitalPlaneToReference(xp, yp, el, out);
}

/** Rotates a point in the orbital plane (x → periapsis) into the reference frame. */
export function orbitalPlaneToReference(xp: number, yp: number, el: OrbitalElements, out: Vec3 = [0, 0, 0]): Vec3 {
  const cw = Math.cos(el.argPeri), sw = Math.sin(el.argPeri);
  const cO = Math.cos(el.node), sO = Math.sin(el.node);
  const ci = Math.cos(el.i), si = Math.sin(el.i);
  out[0] = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  out[1] = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  out[2] = sw * si * xp + cw * si * yp;
  return out;
}

/**
 * Osculating elements from a position/velocity state (any consistent units,
 * e.g. km and km/s with μ in km³/s²). Handles near-zero inclination by
 * measuring the periapsis from the reference x-axis.
 */
export function stateToElements(r: Readonly<Vec3>, v: Readonly<Vec3>, mu: number): OrbitalElements {
  const rl = Math.hypot(r[0], r[1], r[2]);
  const v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const h: Vec3 = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const hl = Math.hypot(h[0], h[1], h[2]);
  const rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
  // Eccentricity vector: ((v² − μ/r) r − (r·v) v) / μ
  const k = v2 - mu / rl;
  const ev: Vec3 = [(k * r[0] - rv * v[0]) / mu, (k * r[1] - rv * v[1]) / mu, (k * r[2] - rv * v[2]) / mu];
  const e = Math.hypot(ev[0], ev[1], ev[2]);
  const a = 1 / (2 / rl - v2 / mu);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hl)));
  const n: Vec3 = [-h[1], h[0], 0];
  const nl = Math.hypot(n[0], n[1]);

  let node: number, argPeri: number;
  // Angle within the orbital plane from a reference direction p to vector q.
  const planeAngle = (p: Readonly<Vec3>, q: Readonly<Vec3>) => {
    const cx = p[1] * q[2] - p[2] * q[1], cy = p[2] * q[0] - p[0] * q[2], cz = p[0] * q[1] - p[1] * q[0];
    return Math.atan2((cx * h[0] + cy * h[1] + cz * h[2]) / hl, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]);
  };
  const periDir: Vec3 = e > 1e-10 ? ev : [r[0], r[1], r[2]];
  if (nl < 1e-12 * hl) {
    node = 0;
    argPeri = planeAngle([1, 0, 0], periDir);
  } else {
    node = Math.atan2(n[1], n[0]);
    argPeri = planeAngle(n, periDir);
  }
  const nu = e > 1e-10 ? planeAngle(ev, r) : 0;
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  return { a, e, i, node, argPeri, M: E - e * Math.sin(E) };
}

/**
 * Samples the full ellipse, starting at the body's current position so the
 * first point coincides with it. Returns `count` points (not closed).
 */
export function sampleOrbit(el: OrbitalElements, count: number): Vec3[] {
  const E0 = solveKepler(el.M, el.e);
  const b = el.a * Math.sqrt(1 - el.e * el.e);
  const pts: Vec3[] = [];
  for (let k = 0; k < count; k++) {
    // Uniform in eccentric anomaly gives denser sampling near periapsis.
    const E = E0 + (2 * Math.PI * k) / count;
    pts.push(orbitalPlaneToReference(el.a * (Math.cos(E) - el.e), b * Math.sin(E), el));
  }
  return pts;
}
