// Shared helpers for the data tools: cached downloads, VizieR TSV parsing,
// sexagesimal parsing and fast positional cross-matching.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const rawDir = resolve(root, '.cache/raw');
export const dataOut = resolve(root, 'apps/web/public/data');
export const DEG = Math.PI / 180;

/** Downloads `url` into .cache/raw/<file> unless present; returns the local path. */
export async function download(url, file) {
  mkdirSync(rawDir, { recursive: true });
  const dest = resolve(rawDir, file);
  if (!existsSync(dest)) {
    console.log(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  return dest;
}

/**
 * Fetches a whole VizieR table as TSV (cached) and returns rows as objects
 * keyed by column name, with values trimmed (empty → '').
 */
export async function vizier(source, file, columns = null) {
  const params = new URLSearchParams({ '-source': source, '-out.max': 'unlimited' });
  if (columns) params.set('-out', columns.join(','));
  else params.set('-out.all', '');
  const path = await download(`https://vizier.cds.unistra.fr/viz-bin/asu-tsv?${params}`, file);
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const header = lines[0].split('\t').map((h) => h.trim());
  // Line 1 = units, line 2 = dashes.
  return lines.slice(3).map((l) => {
    const f = l.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, (f[i] ?? '').trim()]));
  });
}

export const num = (s) => (s === '' || s === undefined ? NaN : Number(s));

/** "05 35 17.3" / "05:35:17.3" hours → degrees. */
export function hmsToDeg(s) {
  const [h, m = 0, sec = 0] = s.trim().split(/[\s:]+/).map(Number);
  return (h + m / 60 + sec / 3600) * 15;
}

/** "-05 23 28" / "-05:23:28" → degrees (sign from the string, so "-00 30" works). */
export function dmsToDeg(s) {
  const t = s.trim();
  const neg = t.startsWith('-');
  const [d, m = 0, sec = 0] = t.replace(/^[+-]/, '').split(/[\s:]+/).map(Number);
  return (neg ? -1 : 1) * (d + m / 60 + sec / 3600);
}

export function unitVector(raDeg, decDeg) {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

/** Angular separation in degrees. */
export function separation(ra1, dec1, ra2, dec2) {
  const a = unitVector(ra1, dec1), b = unitVector(ra2, dec2);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(...c), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / DEG;
}

/** Spatial index on the sky (1° Dec bands × RA cells) for nearest-neighbour matching. */
export class SkyIndex {
  constructor(items, raOf, decOf) {
    this.cells = new Map();
    this.raOf = raOf;
    this.decOf = decOf;
    for (const it of items) {
      const k = this.key(raOf(it), decOf(it));
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(it);
    }
  }

  key(ra, dec) {
    return `${Math.floor(dec + 90)}:${Math.floor(((ra % 360) + 360) % 360)}`;
  }

  /** Nearest item within maxDeg (must be ≤ 1°), or undefined. */
  nearest(ra, dec, maxDeg) {
    let best, bestD = maxDeg;
    const d0 = Math.floor(dec + 90);
    for (let dd = -1; dd <= 1; dd++) {
      // Near the poles RA cells shrink, so widen the RA search.
      const widen = Math.min(180, Math.ceil(1 / Math.max(Math.cos(Math.min(89.5, Math.abs(dec) + 1) * DEG), 1e-3)));
      for (let dr = -widen; dr <= widen; dr++) {
        const c = this.cells.get(`${d0 + dd}:${(((Math.floor(ra) + dr) % 360) + 360) % 360}`);
        if (!c) continue;
        for (const it of c) {
          const s = separation(ra, dec, this.raOf(it), this.decOf(it));
          if (s < bestD) {
            bestD = s;
            best = it;
          }
        }
      }
    }
    return best;
  }
}

/** Deterministic 32-bit hash → [0, 1). */
export function hash01(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function writeJson(name, data) {
  writeFileSync(resolve(dataOut, name), JSON.stringify(data));
}

export { writeFileSync, readFileSync, existsSync, resolve };
