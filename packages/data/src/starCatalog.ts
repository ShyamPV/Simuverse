/**
 * Star catalogue decoding. Runs inside a worker (see stars.worker.ts) so the
 * main thread only receives ready-to-upload typed arrays.
 */

import { EQUATORIAL_TO_ECLIPTIC, bvToRgb } from '@simuverse/astro';

export const STAR_MAGIC = 'SVS1';
const HEADER_BYTES = 16;

export interface StarNameEntry {
  i: number;
  name?: string;
  bayer?: string;
  flam?: number;
  con?: string;
  hip?: number;
  spect?: string;
}

/** GPU-ready star arrays, ecliptic J2000 axes, parsecs from the Sun. */
export interface StarBuffers {
  count: number;
  /** xyz per star, parsecs, ecliptic J2000. */
  positions: Float32Array;
  /** Absolute magnitude per star. */
  absMag: Float32Array;
  /** Linear RGB chromaticity per star (max channel = 1). */
  colors: Float32Array;
  /** B−V colour index per star. */
  bv: Float32Array;
  /** Bit flags per star (bit 0: placeholder distance). */
  flags: Uint8Array;
}

/** Decodes the SVS1 binary catalogue built by tools/build-stars.mjs. */
export function decodeStarCatalog(buffer: ArrayBuffer): StarBuffers {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== STAR_MAGIC) throw new Error(`Bad star catalogue magic: ${magic}`);
  const count = view.getUint32(4, true);
  const stride = view.getUint32(8, true);
  const src = new Float32Array(buffer, HEADER_BYTES, count * stride);

  const positions = new Float32Array(count * 3);
  const absMag = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const bv = new Float32Array(count);
  const flags = new Uint8Array(count);
  const m = EQUATORIAL_TO_ECLIPTIC;
  // B−V is quantised to 0.01 for the colour lookup; the blackbody integral is slow-ish.
  const colorCache = new Map<number, [number, number, number]>();

  for (let i = 0; i < count; i++) {
    const o = i * stride;
    const x = src[o]!, y = src[o + 1]!, z = src[o + 2]!;
    positions[i * 3] = m[0] * x + m[1] * y + m[2] * z;
    positions[i * 3 + 1] = m[3] * x + m[4] * y + m[5] * z;
    positions[i * 3 + 2] = m[6] * x + m[7] * y + m[8] * z;
    absMag[i] = src[o + 3]!;
    bv[i] = src[o + 4]!;
    const bvKey = Math.round(src[o + 4]! * 100);
    let rgb = colorCache.get(bvKey);
    if (!rgb) {
      rgb = bvToRgb(bvKey / 100);
      colorCache.set(bvKey, rgb);
    }
    colors.set(rgb, i * 3);
    flags[i] = src[o + 5]!;
  }
  return { count, positions, absMag, colors, bv, flags };
}

const GREEK: Record<string, string> = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ',
  Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ',
  Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};

/** Display name: proper name, else Bayer ("α Cen"), else Flamsteed ("61 Cyg"). */
export function starDisplayName(e: StarNameEntry): string | undefined {
  if (e.name) return e.name;
  if (e.bayer && e.con) {
    const [letter, sup] = e.bayer.split('-');
    const greek = GREEK[letter!] ?? letter;
    const supers = sup ? sup.replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]!) : '';
    return `${greek}${supers} ${e.con}`;
  }
  if (e.flam && e.con) return `${e.flam} ${e.con}`;
  return undefined;
}
