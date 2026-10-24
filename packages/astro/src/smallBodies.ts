/**
 * Asteroids, dwarf planets and comets from osculating elements (JPL SBDB),
 * propagated as two-body orbits about the Sun: elliptic, or hyperbolic for
 * interstellar visitors. Planetary perturbations are ignored, so accuracy
 * degrades with time from the element epoch (arcminutes over a few years for
 * main-belt asteroids, degrees over decades for Halley's Comet).
 */

import { DEG } from './units.ts';
import type { Vec3 } from './vec.ts';

/** Gaussian gravitational constant squared: GM☉ in AU³/day². */
const K2 = 0.01720209895 ** 2;

export interface SmallBodyElements {
  /** Eccentricity, perihelion distance (AU), inclination, node, argument of perihelion (deg), perihelion time (JD TDB). */
  e: number;
  q: number;
  i: number;
  node: number;
  peri: number;
  tp: number;
}

/** Heliocentric position, ecliptic J2000, AU. */
export function smallBodyPosition(el: SmallBodyElements, jdTdb: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const { e, q } = el;
  const dt = jdTdb - el.tp;
  let x: number, y: number;
  if (e < 1) {
    const a = q / (1 - e);
    const n = Math.sqrt(K2 / a ** 3);
    const M = n * dt;
    const Mw = Math.atan2(Math.sin(M), Math.cos(M));
    // Newton from π converges for any eccentricity; from M is quicker for nearly circular orbits.
    let E = e < 0.8 ? Mw : Math.sign(Mw || 1) * Math.PI;
    for (let k = 0; k < 50; k++) {
      const dE = (E - e * Math.sin(E) - Mw) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-13) break;
    }
    x = a * (Math.cos(E) - e);
    y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  } else {
    const a = q / (e - 1);
    const n = Math.sqrt(K2 / a ** 3);
    const M = n * dt;
    // e sinh H − H = M, started from the asymptotic solution.
    let H = Math.asinh(M / e);
    for (let k = 0; k < 60; k++) {
      const dH = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
      H -= dH;
      if (Math.abs(dH) < 1e-13) break;
    }
    x = a * (e - Math.cosh(H));
    y = a * Math.sqrt(e * e - 1) * Math.sinh(H);
  }
  const O = el.node * DEG, w = el.peri * DEG, inc = el.i * DEG;
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(inc), si = Math.sin(inc);
  const x1 = cw * x - sw * y, y1 = sw * x + cw * y;
  out[0] = cO * x1 - sO * ci * y1;
  out[1] = sO * x1 + cO * ci * y1;
  out[2] = si * y1;
  return out;
}

/** Orbital period in days (Infinity for open orbits). */
export function smallBodyPeriod(el: SmallBodyElements): number {
  if (el.e >= 1) return Infinity;
  const a = el.q / (1 - el.e);
  return (2 * Math.PI) / Math.sqrt(K2 / a ** 3);
}

/**
 * Asteroid magnitude (IAU H–G system); r, Δ in AU, phase angle in radians.
 * With no H, it is estimated from the diameter (km) and geometric albedo.
 */
export function asteroidMagnitude(
  r: number, delta: number, phase: number, p: { H: number | null; G: number | null; diameterKm: number | null; albedo: number | null },
): number {
  const H = p.H ?? (p.diameterKm ? 5 * Math.log10(1329 / (p.diameterKm * Math.sqrt(p.albedo ?? 0.1))) : 18);
  const G = p.G ?? 0.15;
  const t = Math.tan(phase / 2);
  const phi1 = Math.exp(-3.33 * t ** 0.63), phi2 = Math.exp(-1.87 * t ** 1.22);
  return H + 5 * Math.log10(r * delta) - 2.5 * Math.log10(Math.max((1 - G) * phi1 + G * phi2, 1e-6));
}

/** Comet total magnitude: m = M1 + 5 log Δ + K1 log r. */
export function cometMagnitude(r: number, delta: number, M1: number, K1: number): number {
  return M1 + 5 * Math.log10(delta) + K1 * Math.log10(r);
}
