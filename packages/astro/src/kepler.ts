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
