/**
 * Chebyshev ephemeris chunks fitted to JPL DE440 (see tools/build-ephemeris.mjs).
 * Positions are km in ecliptic J2000 axes, relative to each body's centre:
 *   sun → solar-system barycentre; mercury…pluto, emb → Sun; moon → Earth.
 */

import type { Vec3 } from './vec.ts';

export const EPHEMERIS_MAGIC = 'SVE1';

export type EphemerisBodyId =
  | 'sun' | 'mercury' | 'venus' | 'emb' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto' | 'moon';

export interface ChebyshevSeries {
  id: string;
  segmentDays: number;
  degree: number;
  firstJd: number;
  segmentCount: number;
  /** [segment][axis][degree + 1] */
  coeffs: Float32Array;
}

export interface EphemerisChunk {
  startJd: number;
  endJd: number;
  series: Map<string, ChebyshevSeries>;
}

export function decodeEphemerisChunk(buffer: ArrayBuffer): EphemerisChunk {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== EPHEMERIS_MAGIC) throw new Error(`Bad ephemeris magic ${magic}`);
  const count = view.getUint32(8, true);
  const startJd = view.getFloat64(16, true);
  const endJd = view.getFloat64(24, true);
  const series = new Map<string, ChebyshevSeries>();
  for (let i = 0; i < count; i++) {
    const d = 32 + i * 32;
    const id = String.fromCharCode(...new Uint8Array(buffer, d, 8)).replace(/\0+$/, '');
    const segmentDays = view.getUint32(d + 8, true);
    const degree = view.getUint32(d + 12, true);
    const segmentCount = view.getUint32(d + 16, true);
    const offset = view.getUint32(d + 20, true);
    const firstJd = view.getFloat64(d + 24, true);
    const coeffs = new Float32Array(buffer, offset, segmentCount * 3 * (degree + 1));
    series.set(id, { id, segmentDays, degree, firstJd, segmentCount, coeffs });
  }
  return { startJd, endJd, series };
}

/** Clenshaw summation of Σ c_k T_k(u) for coefficients at [offset, offset + n). */
function clenshaw(c: Float32Array, offset: number, n: number, u: number): number {
  let b0 = 0, b1 = 0, b2 = 0;
  const u2 = 2 * u;
  for (let k = n - 1; k >= 1; k--) {
    b2 = b1;
    b1 = b0;
    b0 = u2 * b1 - b2 + c[offset + k]!;
  }
  return u * b0 - b1 + c[offset]!;
}

/** Evaluates a series at a TDB Julian date. Returns false if jd is outside its segments. */
export function evaluateSeries(s: ChebyshevSeries, jdTdb: number, out: Vec3): boolean {
  const rel = jdTdb - s.firstJd;
  let seg = Math.floor(rel / s.segmentDays);
  if (seg < 0 || seg > s.segmentCount) return false;
  if (seg === s.segmentCount) {
    // Exactly at the end of the last segment.
    if (rel > s.segmentCount * s.segmentDays) return false;
    seg = s.segmentCount - 1;
  }
  const u = (2 * (rel - seg * s.segmentDays)) / s.segmentDays - 1;
  const n = s.degree + 1;
  const base = seg * 3 * n;
  out[0] = clenshaw(s.coeffs, base, n, u);
  out[1] = clenshaw(s.coeffs, base + n, n, u);
  out[2] = clenshaw(s.coeffs, base + 2 * n, n, u);
  return true;
}

/** A set of loaded chunks; looks up the one covering a date. */
export class EphemerisStore {
  private chunks: EphemerisChunk[] = [];

  add(chunk: EphemerisChunk): void {
    if (this.chunks.some((c) => c.startJd === chunk.startJd)) return;
    this.chunks.push(chunk);
    this.chunks.sort((a, b) => a.startJd - b.startJd);
  }

  covers(jdTdb: number): boolean {
    return this.chunks.some((c) => jdTdb >= c.startJd && jdTdb < c.endJd);
  }

  get loadedRanges(): [number, number][] {
    return this.chunks.map((c) => [c.startJd, c.endJd]);
  }

  /** Raw series position in km (relative to the series' own centre). */
  position(id: EphemerisBodyId, jdTdb: number, out: Vec3): boolean {
    for (const c of this.chunks) {
      if (jdTdb >= c.startJd && jdTdb < c.endJd) {
        const s = c.series.get(id);
        return s ? evaluateSeries(s, jdTdb, out) : false;
      }
    }
    return false;
  }
}
