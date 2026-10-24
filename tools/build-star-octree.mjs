#!/usr/bin/env node
// Builds the streamed star octree from AT-HYG v4.0 (D. Nash, CC BY-SA 4.0;
// Tycho-2 + Gaia DR3 + Hipparcos + HYG). Stars already in the bundled HYG
// catalogue are skipped, so the two never double up.
//
// Magnitude-sorted LOD octree (as in Gaia Sky): stars are sorted by absolute
// magnitude; each node keeps the CAPACITY intrinsically brightest stars inside
// its box and hands the rest to its children. A child can only hold stars at
// least as faint as its parent's faintest, which makes runtime LOD selection
// exact: load a child only if its brightest star could be visible from the
// camera at the box's nearest point.
//
// Output (apps/web/public/data/stars/):
//   index.json   { version, capacity, halfSize, nodes: [{ c:[x,y,z], h, n, minM, maxM, k:[child ids] }] }
//   t/<id>.bin   'SVT1', uint32 count, 8 bytes reserved, then 14-byte records:
//                uint16 qx, qy, qz (position in the node box), int16 absMag×1000,
//                uint8 (B−V + 0.5)×70, uint8 flags, uint32 AT-HYG id
// Positions are ICRS equatorial parsecs from the Sun.

import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { dataOut, download, resolve } from './lib.mjs';

const CAPACITY = 4096;
const HALF_SIZE = 16384; // pc; stars beyond are dropped
const MAX_DEPTH = 14;
const RECORD = 14;

async function main() {
  const src = await download('https://codeberg.org/astronexus/athyg/media/branch/main/data/athyg_40.csv.gz', 'athyg_40.csv.gz');
  const rl = createInterface({ input: createReadStream(src).pipe(createGunzip()), crlfDelay: Infinity });

  let cols = null;
  const cap = 2_700_000;
  const x = new Float64Array(cap), y = new Float64Array(cap), z = new Float64Array(cap);
  const absMag = new Float32Array(cap), ci = new Float32Array(cap);
  const ids = new Uint32Array(cap);
  let n = 0, skippedHyg = 0, skippedNoDist = 0, skippedFar = 0;
  for await (const line of rl) {
    if (!cols) {
      cols = Object.fromEntries(line.split(',').map((c, i) => [c, i]));
      continue;
    }
    // Fields contain no quoted commas in AT-HYG's numeric/ID columns we use, but names may.
    const f = line.split(',');
    if (f[cols.hyg] !== '' || f[cols.proper] === 'Sol') {
      skippedHyg++;
      continue;
    }
    const dist = Number(f[cols.dist]);
    const am = Number(f[cols.absmag]);
    if (!(dist > 0) || !Number.isFinite(am) || f[cols.dist_src] === '') {
      skippedNoDist++;
      continue;
    }
    const px = Number(f[cols.x0]), py = Number(f[cols.y0]), pz = Number(f[cols.z0]);
    if (Math.max(Math.abs(px), Math.abs(py), Math.abs(pz)) >= HALF_SIZE) {
      skippedFar++;
      continue;
    }
    x[n] = px; y[n] = py; z[n] = pz;
    absMag[n] = am;
    ci[n] = f[cols.ci] === '' ? 0.65 : Number(f[cols.ci]);
    ids[n] = Number(f[cols.id]);
    n++;
  }
  console.log(`Read ${n} stars (skipped ${skippedHyg} in HYG, ${skippedNoDist} without distance, ${skippedFar} beyond ${HALF_SIZE} pc)`);

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => absMag[a] - absMag[b]);

  const outDir = resolve(dataOut, 'stars');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(resolve(outDir, 't'), { recursive: true });
  const nodes = [];

  function build(indices, cx, cy, cz, h, depth) {
    const id = nodes.length;
    const own = depth >= MAX_DEPTH ? indices : indices.slice(0, CAPACITY);
    const rest = depth >= MAX_DEPTH ? [] : indices.slice(CAPACITY);
    const node = { c: [cx, cy, cz], h, n: own.length, minM: absMag[own[0]], maxM: absMag[own[own.length - 1]], k: [] };
    nodes.push(node);
    writeTile(id, own, cx, cy, cz, h);
    if (rest.length) {
      const buckets = Array.from({ length: 8 }, () => []);
      for (const i of rest) {
        const o = (x[i] >= cx ? 1 : 0) | (y[i] >= cy ? 2 : 0) | (z[i] >= cz ? 4 : 0);
        buckets[o].push(i); // stays brightness-sorted
      }
      const hh = h / 2;
      buckets.forEach((b, o) => {
        if (!b.length) return;
        node.k.push(build(b, cx + (o & 1 ? hh : -hh), cy + (o & 2 ? hh : -hh), cz + (o & 4 ? hh : -hh), hh, depth + 1));
      });
    }
    return id;
  }

  function writeTile(id, own, cx, cy, cz, h) {
    const buf = Buffer.alloc(16 + own.length * RECORD);
    buf.write('SVT1', 0, 'ascii');
    buf.writeUInt32LE(own.length, 4);
    const q = (v, c) => Math.max(0, Math.min(65535, Math.round(((v - (c - h)) / (2 * h)) * 65535)));
    own.forEach((i, k) => {
      const o = 16 + k * RECORD;
      buf.writeUInt16LE(q(x[i], cx), o);
      buf.writeUInt16LE(q(y[i], cy), o + 2);
      buf.writeUInt16LE(q(z[i], cz), o + 4);
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(absMag[i] * 1000))), o + 6);
      buf.writeUInt8(Math.max(0, Math.min(255, Math.round((ci[i] + 0.5) * 70))), o + 8);
      buf.writeUInt8(0, o + 9);
      buf.writeUInt32LE(ids[i], o + 10);
    });
    writeFileSync(resolve(outDir, 't', `${id}.bin`), buf);
  }

  build(order, 0, 0, 0, HALF_SIZE, 0);
  const round = (v) => Math.round(v * 1000) / 1000;
  writeFileSync(
    resolve(outDir, 'index.json'),
    JSON.stringify({
      version: 1, capacity: CAPACITY, halfSize: HALF_SIZE, count: n,
      nodes: nodes.map((d) => ({ c: d.c.map(round), h: d.h, n: d.n, minM: round(d.minM), maxM: round(d.maxM), k: d.k })),
    }),
  );
  const depth = (id, dd = 0) => Math.max(dd, ...nodes[id].k.map((c) => depth(c, dd + 1)));
  console.log(`Wrote ${nodes.length} tiles, max depth ${depth(0)}, ${((n * RECORD) / 1e6).toFixed(1)} MB of records`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
