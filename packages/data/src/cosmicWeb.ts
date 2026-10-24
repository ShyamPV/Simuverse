/**
 * Procedural large-scale structure beyond the reach of the real galaxy
 * catalogue. Everything here is deterministic (seeded by integer coordinates)
 * and flagged "approximate" wherever it is shown.
 *
 * Structure: space is divided into SUBCELL-sized cells; a cell holds a
 * cluster node with probability NODE_PROBABILITY. Nodes connect to their
 * nearest neighbours by filaments. Galaxies are placed in clusters (around
 * nodes), along filaments, or sparsely in the field, so voids emerge.
 *
 * Level of detail: an implicit octree of the observable universe. Each depth
 * owns a band of absolute magnitudes (brightest at the root), sized so a node
 * holds about NODE_CAPACITY galaxies — the same rule as the star octree, so a
 * child is only loaded if its brightest galaxy could be visible.
 */

export const WEB_ROOT_HALF_MPC = 16384;
export const WEB_MAX_DEPTH = 9;
export const WEB_SUBCELL_MPC = 25;
/** Inside this radius the real catalogue is used; procedural galaxies fade in across the band. */
export const WEB_FADE_INNER_MPC = 230;
export const WEB_FADE_OUTER_MPC = 330;
/** Comoving radius of the observable universe (Planck 2018 cosmology), Mpc. */
export const OBSERVABLE_RADIUS_MPC = 14_250;
export const NODE_CAPACITY = 3000;
const NODE_PROBABILITY = 0.42;
const SEED = 0x5eed;

// Schechter luminosity function in V (h = 0.7): φ* [Mpc⁻³], M*, α.
const PHI_STAR = 3.2e-3;
const M_STAR = -21.2;
const ALPHA = -1.1;
const M_BRIGHT = -24.5;
const M_FAINT = -16;

/** Cumulative number density of galaxies brighter than M, Mpc⁻³ (numerical integral). */
export function cumulativeDensity(M: number): number {
  let n = 0;
  const step = 0.02;
  for (let m = M_BRIGHT; m < M; m += step) {
    const x = 10 ** (-0.4 * (m + step / 2 - M_STAR));
    n += 0.4 * Math.LN10 * PHI_STAR * x ** (ALPHA + 1) * Math.exp(-x) * step;
  }
  return n;
}

/** Magnitude band [bright, faint) owned by each octree depth. */
export const WEB_BANDS: [number, number][] = (() => {
  const bands: [number, number][] = [];
  let bright = M_BRIGHT;
  for (let d = 0; d <= WEB_MAX_DEPTH; d++) {
    const volume = (2 * WEB_ROOT_HALF_MPC / 2 ** d) ** 3;
    const target = cumulativeDensity(bright) + NODE_CAPACITY / volume;
    let faint = bright;
    while (faint < M_FAINT && cumulativeDensity(faint) < target) faint += 0.05;
    if (d === WEB_MAX_DEPTH) faint = M_FAINT;
    bands.push([bright, Math.min(faint, M_FAINT)]);
    bright = Math.min(faint, M_FAINT);
  }
  return bands;
})();

export interface WebNodeKey {
  depth: number;
  ix: number;
  iy: number;
  iz: number;
}

export const webNodeSize = (depth: number) => (2 * WEB_ROOT_HALF_MPC) / 2 ** depth;

export function webNodeCenter(k: WebNodeKey): [number, number, number] {
  const s = webNodeSize(k.depth);
  return [-WEB_ROOT_HALF_MPC + (k.ix + 0.5) * s, -WEB_ROOT_HALF_MPC + (k.iy + 0.5) * s, -WEB_ROOT_HALF_MPC + (k.iz + 0.5) * s];
}

export const webNodeId = (k: WebNodeKey) => `${k.depth}/${k.ix}/${k.iy}/${k.iz}`;

// ---------------------------------------------------------------- deterministic randomness

function hash3(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(salt | 0, 0x165667b1) ^ SEED;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Mulberry32 PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

// ---------------------------------------------------------------- structure

interface CellNode {
  p: [number, number, number];
  /** Relative richness (cluster size), 0.3–3. */
  mass: number;
}

/** The cluster node in a structure cell, if any (pure function of the cell indices). */
export function cellNode(cx: number, cy: number, cz: number): CellNode | null {
  const r = rng(hash3(cx, cy, cz, 1));
  if (r() > NODE_PROBABILITY) return null;
  const s = WEB_SUBCELL_MPC;
  return {
    p: [(cx + 0.15 + 0.7 * r()) * s, (cy + 0.15 + 0.7 * r()) * s, (cz + 0.15 + 0.7 * r()) * s],
    mass: 0.3 + 2.7 * r() ** 3,
  };
}

/** Filament partners: the three nearest nodes among the 26 neighbouring cells. */
function filaments(cx: number, cy: number, cz: number, self: CellNode, cache: Map<string, CellNode | null>): CellNode[] {
  const near: { n: CellNode; d: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue;
        const key = `${cx + dx},${cy + dy},${cz + dz}`;
        let n = cache.get(key);
        if (n === undefined) {
          n = cellNode(cx + dx, cy + dy, cz + dz);
          cache.set(key, n);
        }
        if (n) near.push({ n, d: Math.hypot(n.p[0] - self.p[0], n.p[1] - self.p[1], n.p[2] - self.p[2]) });
      }
    }
  }
  near.sort((a, b) => a.d - b.d);
  return near.slice(0, 3).map((x) => x.n);
}

// ---------------------------------------------------------------- generation

export interface WebNodeData {
  count: number;
  /** xyz relative to the node centre, Mpc (world axes). */
  positions: Float32Array;
  absMag: Float32Array;
  /** 0 = cluster (red, early-type), 1 = filament, 2 = field (blue, late-type). */
  environment: Uint8Array;
}

/** Samples an absolute magnitude in [bright, faint) from the Schechter function. */
function sampleMagnitude(r: () => number, bright: number, faint: number): number {
  // Rejection sampling against the (monotone over this range) density at the faint end.
  const density = (m: number) => {
    const x = 10 ** (-0.4 * (m - M_STAR));
    return x ** (ALPHA + 1) * Math.exp(-x);
  };
  const max = Math.max(density(bright), density(faint), density(Math.min(Math.max(M_STAR, bright), faint)));
  for (let k = 0; k < 64; k++) {
    const m = bright + (faint - bright) * r();
    if (r() * max <= density(m)) return m;
  }
  return faint;
}

export function generateWebNode(key: WebNodeKey): WebNodeData {
  const [bright, faint] = WEB_BANDS[key.depth]!;
  const size = webNodeSize(key.depth);
  const half = size / 2;
  const [cx, cy, cz] = webNodeCenter(key);
  const expected = (cumulativeDensity(faint) - cumulativeDensity(bright)) * size ** 3;
  const target = Math.min(NODE_CAPACITY, Math.round(expected));
  const r = rng(hash3(key.ix, key.iy, key.iz, 100 + key.depth));
  const cache = new Map<string, CellNode | null>();
  const node = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`;
    let n = cache.get(k);
    if (n === undefined) {
      n = cellNode(x, y, z);
      cache.set(k, n);
    }
    return n;
  };

  const pos: number[] = [], mags: number[] = [], env: number[] = [];
  const s = WEB_SUBCELL_MPC;
  // Attempts are bounded: rejections (voids, the catalogue sphere, beyond the horizon) thin the result.
  for (let attempt = 0; attempt < target * 3 && env.length < target; attempt++) {
    // Pick a structure cell inside this node.
    const px = cx - half + size * r(), py = cy - half + size * r(), pz = cz - half + size * r();
    const ix = Math.floor(px / s), iy = Math.floor(py / s), iz = Math.floor(pz / s);
    const home = node(ix, iy, iz);
    let p: [number, number, number];
    let e: number;
    const u = r();
    if (home && u < 0.4) {
      const spread = 1.2 + 1.8 * home.mass;
      p = [home.p[0] + gaussian(r) * spread, home.p[1] + gaussian(r) * spread, home.p[2] + gaussian(r) * spread];
      e = 0;
    } else if (home && u < 0.95) {
      const partners = filaments(ix, iy, iz, home, cache);
      if (!partners.length) continue;
      const other = partners[Math.floor(r() * partners.length)]!;
      const t = 0.5 * r(); // each end owns half the filament, so density is even along it
      const w = 0.9;
      p = [
        home.p[0] + (other.p[0] - home.p[0]) * t + gaussian(r) * w,
        home.p[1] + (other.p[1] - home.p[1]) * t + gaussian(r) * w,
        home.p[2] + (other.p[2] - home.p[2]) * t + gaussian(r) * w,
      ];
      e = 1;
    } else {
      // Field galaxies; empty cells (voids) keep only a twentieth of them.
      if (!home && r() > 0.05) continue;
      p = [px, py, pz];
      e = 2;
    }
    const d = Math.hypot(p[0], p[1], p[2]);
    if (d > OBSERVABLE_RADIUS_MPC) continue;
    if (d < WEB_FADE_OUTER_MPC) {
      const f = Math.min(Math.max((d - WEB_FADE_INNER_MPC) / (WEB_FADE_OUTER_MPC - WEB_FADE_INNER_MPC), 0), 1);
      if (r() > f * f * (3 - 2 * f)) continue;
    }
    pos.push(p[0] - cx, p[1] - cy, p[2] - cz);
    mags.push(sampleMagnitude(r, bright, faint));
    env.push(e);
  }
  return {
    count: env.length,
    positions: Float32Array.from(pos),
    absMag: Float32Array.from(mags),
    environment: Uint8Array.from(env),
  };
}

/** Distance from a point to a node's box (0 inside). */
function boxDistance(p: readonly number[], c: readonly number[], h: number): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(p[i]! - c[i]!) - h;
    if (d > 0) s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Nodes of the implicit octree worth showing from `camMpc`: a node is visited
 * if its band's brightest galaxy, at the box's nearest point, beats magLimit.
 * Nodes entirely inside the catalogue sphere or beyond the horizon are skipped.
 */
export function selectWebNodes(camMpc: readonly number[], magLimit: number, maxGalaxies: number): WebNodeKey[] {
  const out: WebNodeKey[] = [];
  const frontier: { k: WebNodeKey; best: number }[] = [{ k: { depth: 0, ix: 0, iy: 0, iz: 0 }, best: -Infinity }];
  let budget = maxGalaxies;
  while (frontier.length && budget > 0) {
    frontier.sort((a, b) => b.best - a.best);
    const { k } = frontier.pop()!;
    const c = webNodeCenter(k);
    const h = webNodeSize(k.depth) / 2;
    const fromSun = Math.hypot(c[0], c[1], c[2]);
    const r = h * Math.sqrt(3);
    if (fromSun - r > OBSERVABLE_RADIUS_MPC || fromSun + r < WEB_FADE_INNER_MPC) continue;
    out.push(k);
    budget -= NODE_CAPACITY;
    if (k.depth >= WEB_MAX_DEPTH) continue;
    const [bright] = WEB_BANDS[k.depth + 1]!;
    for (let o = 0; o < 8; o++) {
      const child = { depth: k.depth + 1, ix: k.ix * 2 + (o & 1), iy: k.iy * 2 + ((o >> 1) & 1), iz: k.iz * 2 + ((o >> 2) & 1) };
      const cc = webNodeCenter(child);
      const d = Math.max(boxDistance(camMpc, cc, h / 2), 1e-3);
      const best = bright + 5 * Math.log10((d * 1e6) / 10);
      if (best < magLimit) frontier.push({ k: child, best });
    }
  }
  return out;
}
