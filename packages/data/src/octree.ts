/**
 * Streamed star octree (built by tools/build-star-octree.mjs from AT-HYG).
 *
 * Each node holds the intrinsically brightest stars in its box that its
 * ancestors didn't take, so every star in a child is at least as faint as
 * `minM` of that child. A child is worth loading only if that brightest star,
 * placed at the box's point nearest the camera, would beat the magnitude limit.
 */

import { EQUATORIAL_TO_ECLIPTIC, bvToRgb } from '@simuverse/astro';

export interface OctreeNode {
  /** Box centre, pc, ICRS equatorial. */
  c: [number, number, number];
  /** Half edge length, pc. */
  h: number;
  /** Star count. */
  n: number;
  /** Brightest and faintest absolute magnitude in the node. */
  minM: number;
  maxM: number;
  /** Child node ids. */
  k: number[];
}

export interface OctreeIndex {
  version: number;
  capacity: number;
  halfSize: number;
  count: number;
  nodes: OctreeNode[];
}

/** Distance from a point to an axis-aligned box (0 inside). */
export function distanceToBox(p: readonly number[], c: readonly number[], h: number): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(p[i]! - c[i]!) - h;
    if (d > 0) s += d * d;
  }
  return Math.sqrt(s);
}

export interface NodeSelection {
  id: number;
  /** Brightest apparent magnitude any star in the node could have from the camera. */
  bestMag: number;
}

/**
 * Nodes to display for a camera at `camPc` (ICRS pc). Visits the brightest-
 * possible nodes first and stops at `maxStars` so dense regions can't blow
 * the budget. The root is always included.
 */
export function selectOctreeNodes(index: OctreeIndex, camPc: readonly number[], magLimit: number, maxStars: number): NodeSelection[] {
  const nodes = index.nodes;
  const best = (id: number) => {
    const n = nodes[id]!;
    const d = Math.max(distanceToBox(camPc, n.c, n.h), 1);
    return n.minM + 5 * Math.log10(d / 10);
  };
  const out: NodeSelection[] = [];
  const heap: NodeSelection[] = [{ id: 0, bestMag: best(0) }];
  let stars = 0;
  while (heap.length) {
    // Small frontier; a sorted pop is fine (hundreds of nodes).
    heap.sort((a, b) => b.bestMag - a.bestMag);
    const next = heap.pop()!;
    const node = nodes[next.id]!;
    if (next.id !== 0 && (next.bestMag > magLimit || stars + node.n > maxStars)) continue;
    out.push(next);
    stars += node.n;
    for (const k of node.k) heap.push({ id: k, bestMag: best(k) });
  }
  return out;
}

export const STAR_TILE_MAGIC = 'SVT1';
const RECORD = 14;

/** Decoded tile, positions relative to the node centre (pc, ecliptic J2000 axes). */
export interface StarTile {
  count: number;
  positions: Float32Array;
  absMag: Float32Array;
  colors: Float32Array;
  ids: Uint32Array;
}

const colorLut = new Map<number, [number, number, number]>();

export function decodeStarTile(buffer: ArrayBuffer, node: OctreeNode): StarTile {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== STAR_TILE_MAGIC) throw new Error(`Bad star tile magic ${magic}`);
  const count = view.getUint32(4, true);
  const positions = new Float32Array(count * 3);
  const absMag = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const ids = new Uint32Array(count);
  const m = EQUATORIAL_TO_ECLIPTIC;
  const scale = (2 * node.h) / 65535;
  for (let i = 0; i < count; i++) {
    const o = 16 + i * RECORD;
    // Quantised position within the box → offset from the centre.
    const x = view.getUint16(o, true) * scale - node.h;
    const y = view.getUint16(o + 2, true) * scale - node.h;
    const z = view.getUint16(o + 4, true) * scale - node.h;
    positions[i * 3] = m[0] * x + m[1] * y + m[2] * z;
    positions[i * 3 + 1] = m[3] * x + m[4] * y + m[5] * z;
    positions[i * 3 + 2] = m[6] * x + m[7] * y + m[8] * z;
    absMag[i] = view.getInt16(o + 6, true) / 1000;
    const q = view.getUint8(o + 8);
    let rgb = colorLut.get(q);
    if (!rgb) {
      rgb = bvToRgb(q / 70 - 0.5);
      colorLut.set(q, rgb);
    }
    colors.set(rgb, i * 3);
    ids[i] = view.getUint32(o + 10, true);
  }
  return { count, positions, absMag, colors, ids };
}
