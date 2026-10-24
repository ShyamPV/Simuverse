/**
 * Galaxy catalogue (tools/build-galaxies.mjs: 2MRS + Cosmicflows-4 + McConnachie
 * + OpenNGC). Decoded into ecliptic J2000 positions (Mpc from the Sun) and a
 * 3D disc orientation per galaxy.
 */

import { EQUATORIAL_TO_ECLIPTIC, galaxyBasis, mulMat3Vec, type Vec3 } from '@simuverse/astro';

export const GALAXY_MAGIC = 'SVGX';

export const GALAXY_FLAG = {
  REDSHIFT_DISTANCE: 1,
  CF4_DISTANCE: 2,
  LOCAL_GROUP: 4,
  PA_UNKNOWN: 8,
  SIZE_FROM_K: 16,
} as const;

export interface GalaxyCatalog {
  count: number;
  /** xyz per galaxy, Mpc, ecliptic J2000, Sun-centred. */
  positions: Float32Array;
  /** Disc major-axis and in-plane minor-axis unit vectors (ecliptic). */
  major: Float32Array;
  minor: Float32Array;
  absMagV: Float32Array;
  radiusKpc: Float32Array;
  axisRatio: Float32Array;
  tType: Float32Array;
  flags: Uint8Array;
  czKmS: Float32Array;
  appMagV: Float32Array;
}

export interface GalaxyName {
  i: number;
  name: string;
  aliases: string[];
  hubble?: string;
}

/** Deterministic hash → [0, 1). */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function decodeGalaxies(buffer: ArrayBuffer): GalaxyCatalog {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== GALAXY_MAGIC) throw new Error(`Bad galaxy catalogue magic ${magic}`);
  const count = view.getUint32(4, true);
  const stride = view.getUint32(8, true);
  const src = new Float32Array(buffer, 16, count * stride);
  const cat: GalaxyCatalog = {
    count,
    positions: new Float32Array(count * 3),
    major: new Float32Array(count * 3),
    minor: new Float32Array(count * 3),
    absMagV: new Float32Array(count),
    radiusKpc: new Float32Array(count),
    axisRatio: new Float32Array(count),
    tType: new Float32Array(count),
    flags: new Uint8Array(count),
    czKmS: new Float32Array(count),
    appMagV: new Float32Array(count),
  };
  const m = EQUATORIAL_TO_ECLIPTIC;
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    const eq: Vec3 = [src[o]!, src[o + 1]!, src[o + 2]!];
    const ecl = mulMat3Vec(m, eq);
    cat.positions.set(ecl, i * 3);
    cat.absMagV[i] = src[o + 3]!;
    cat.radiusKpc[i] = src[o + 4]!;
    cat.axisRatio[i] = src[o + 5]!;
    const pa = src[o + 6]!;
    cat.tType[i] = src[o + 7]!;
    cat.flags[i] = src[o + 8]!;
    cat.czKmS[i] = src[o + 9]!;
    cat.appMagV[i] = src[o + 10]!;
    // Ellipticals are drawn as spheroids; give them the observed flattening on the sky too.
    const knownPa = pa > -900;
    const b = galaxyBasis(eq, knownPa ? pa : hash01(i * 7 + 1) * 180, cat.axisRatio[i]!, hash01(i * 13 + 5) < 0.5);
    cat.major.set(mulMat3Vec(m, b.major), i * 3);
    cat.minor.set(mulMat3Vec(m, b.minor), i * 3);
  }
  return cat;
}

/** Simple Hubble-sequence label from a T-type. */
export function morphologyLabel(t: number): string {
  if (t <= -4) return 'Elliptical';
  if (t <= -1) return 'Lenticular';
  if (t >= 9.5) return 'Irregular';
  if (t >= 8) return 'Magellanic spiral';
  return 'Spiral';
}
