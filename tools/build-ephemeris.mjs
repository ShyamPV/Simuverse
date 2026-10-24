#!/usr/bin/env node
// Builds compact Chebyshev ephemerides (1900–2100) from JPL Horizons (DE440)
// geometric state vectors.
//
//  1. Samples each body on a uniform grid via the Horizons API (cached in .cache/horizons).
//  2. Rotates ICRF equatorial → ecliptic J2000 (IAU 2006 obliquity, the engine's world axes).
//  3. Least-squares fits a degree-N Chebyshev series per L-day segment (x, y, z in km).
//  4. Writes one binary chunk per 50-year block plus a manifest, into apps/web/public/data/ephem.
//
// Chunk format (little-endian), 'SVE1':
//   0  char[4] magic   4 u32 version(1)   8 u32 bodyCount   12 u32 reserved
//   16 f64 blockStartJd   24 f64 blockEndJd
//   32 directory: bodyCount × 32 bytes
//        char[8] id, u32 segmentDays, u32 degree, u32 segmentCount, u32 dataOffset, f64 firstSegmentJd
//   data: float32 coefficients [segment][axis x,y,z][degree+1], km
//
// Usage: node tools/build-ephemeris.mjs [--only moon,mercury]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = resolve(root, '.cache/horizons');
const outDir = resolve(root, 'apps/web/public/data/ephem');

const OBLIQUITY = (84381.406 / 3600) * (Math.PI / 180);
const MAX_LINES = 80_000; // Horizons caps output around 90k lines per request

// Body → Horizons target/centre, segment length (days), Chebyshev degree, sample step.
// Segment sizes follow the DE440 layout, relaxed where sub-arcsecond accuracy allows.
const BODIES = [
  { id: 'sun', command: '10', center: '500@0', L: 32, N: 11, step: '1d' },
  { id: 'mercury', command: '199', center: '500@10', L: 8, N: 13, step: '6h' },
  { id: 'venus', command: '299', center: '500@10', L: 16, N: 10, step: '12h' },
  { id: 'emb', command: '3', center: '500@10', L: 16, N: 13, step: '12h' },
  { id: 'mars', command: '499', center: '500@10', L: 32, N: 11, step: '1d' },
  { id: 'jupiter', command: '599', center: '500@10', L: 32, N: 8, step: '1d' },
  { id: 'saturn', command: '699', center: '500@10', L: 32, N: 7, step: '1d' },
  { id: 'uranus', command: '799', center: '500@10', L: 64, N: 7, step: '2d' },
  { id: 'neptune', command: '899', center: '500@10', L: 64, N: 6, step: '2d' },
  { id: 'pluto', command: '999', center: '500@10', L: 64, N: 6, step: '2d' },
  { id: 'moon', command: '301', center: '500@399', L: 4, N: 12, step: '4h' },
];

const BLOCKS = [
  [1900, 2415020.5],
  [1950, 2433282.5],
  [2000, 2451544.5],
  [2050, 2469807.5],
  [2100, 2488069.5],
];
const SPAN_START = BLOCKS[0][1] - 70; // margin so the first/last segments are fully sampled
const SPAN_END = BLOCKS.at(-1)[1] + 70;

const stepDays = (s) => Number(s.slice(0, -1)) / (s.endsWith('h') ? 24 : 1);

function jdToCal(jd) {
  const ms = (jd - 2440587.5) * 86400000;
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

async function fetchSamples(body) {
  const step = stepDays(body.step);
  const perReq = Math.floor(MAX_LINES * step);
  const t = [], x = [], y = [], z = [];
  for (let a = SPAN_START; a < SPAN_END; a += perReq) {
    const b = Math.min(a + perReq, SPAN_END);
    const file = resolve(cacheDir, `${body.id}-${a}-${body.step}.csv`);
    let text;
    if (existsSync(file)) text = readFileSync(file, 'utf8');
    else {
      const params = new URLSearchParams({
        format: 'text', COMMAND: `'${body.command}'`, EPHEM_TYPE: 'VECTORS', CENTER: `'${body.center}'`,
        REF_PLANE: 'FRAME', REF_SYSTEM: 'ICRF', OUT_UNITS: 'KM-S', VEC_TABLE: '1', VEC_CORR: 'NONE',
        CSV_FORMAT: 'YES', VEC_LABELS: 'NO', OBJ_DATA: 'NO',
        START_TIME: `'JD${a}'`, STOP_TIME: `'JD${b}'`, STEP_SIZE: `'${body.step.replace('h', ' h').replace('d', ' d')}'`,
        TIME_TYPE: 'TDB',
      });
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`);
        text = await res.text();
        if (res.ok && text.includes('$$SOE')) break;
        if (attempt >= 3) throw new Error(`Horizons failed for ${body.id} ${jdToCal(a)}: ${text.slice(0, 400)}`);
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      }
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, text);
      process.stdout.write(`  ${body.id}: ${jdToCal(a)} → ${jdToCal(b)}\n`);
    }
    const rows = text.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n');
    for (const row of rows) {
      const f = row.split(',');
      const jd = Number(f[0]);
      if (t.length && jd <= t[t.length - 1]) continue; // overlap between requests
      const ex = Number(f[2]), ey = Number(f[3]), ez = Number(f[4]);
      // ICRF equatorial → ecliptic J2000
      t.push(jd);
      x.push(ex);
      y.push(Math.cos(OBLIQUITY) * ey + Math.sin(OBLIQUITY) * ez);
      z.push(-Math.sin(OBLIQUITY) * ey + Math.cos(OBLIQUITY) * ez);
    }
  }
  return { t: Float64Array.from(t), x: Float64Array.from(x), y: Float64Array.from(y), z: Float64Array.from(z) };
}

/** Least-squares Chebyshev fit of degree N on samples (u ∈ [−1, 1]) via normal equations + Cholesky. */
function chebFit(u, vals, N) {
  const n = N + 1;
  const A = new Float64Array(n * n);
  const rhs = new Float64Array(n);
  const T = new Float64Array(n);
  for (let s = 0; s < u.length; s++) {
    T[0] = 1;
    if (n > 1) T[1] = u[s];
    for (let k = 2; k < n; k++) T[k] = 2 * u[s] * T[k - 1] - T[k - 2];
    for (let i = 0; i < n; i++) {
      rhs[i] += T[i] * vals[s];
      for (let j = 0; j <= i; j++) A[i * n + j] += T[i] * T[j];
    }
  }
  // Cholesky (lower)
  const Lm = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j];
      for (let k = 0; k < j; k++) sum -= Lm[i * n + k] * Lm[j * n + k];
      Lm[i * n + j] = i === j ? Math.sqrt(sum) : sum / Lm[j * n + j];
    }
  }
  const yv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = rhs[i];
    for (let k = 0; k < i; k++) sum -= Lm[i * n + k] * yv[k];
    yv[i] = sum / Lm[i * n + i];
  }
  const c = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = yv[i];
    for (let k = i + 1; k < n; k++) sum -= Lm[k * n + i] * c[k];
    c[i] = sum / Lm[i * n + i];
  }
  return c;
}

function chebEval(c, u) {
  let b0 = 0, b1 = 0, b2 = 0;
  for (let k = c.length - 1; k >= 1; k--) {
    b2 = b1;
    b1 = b0;
    b0 = 2 * u * b1 - b2 + c[k];
  }
  return u * b0 - b1 + c[0];
}

function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Fits segments covering [startJd, endJd); returns {firstJd, segments: Float32Array, count, maxErrKm}. */
function fitBlock(samples, body, startJd, endJd) {
  const { L, N } = body;
  const count = Math.ceil((endJd - startJd) / L);
  const coeffs = new Float32Array(count * 3 * (N + 1));
  let maxErr = 0;
  for (let s = 0; s < count; s++) {
    const a = startJd + s * L, b = a + L;
    const i0 = lowerBound(samples.t, a - 1e-9), i1 = lowerBound(samples.t, b + 1e-9);
    const u = [], ax = [samples.x, samples.y, samples.z];
    for (let i = i0; i < i1; i++) u.push((2 * (samples.t[i] - a)) / L - 1);
    if (u.length < N + 3) throw new Error(`${body.id}: only ${u.length} samples in segment at JD ${a}`);
    for (let k = 0; k < 3; k++) {
      const vals = Array.from(ax[k].subarray(i0, i1));
      const c = chebFit(u, vals, N);
      // Error measured on the float32-rounded coefficients actually shipped.
      const c32 = Float32Array.from(c);
      coeffs.set(c32, (s * 3 + k) * (N + 1));
      for (let i = 0; i < u.length; i++) maxErr = Math.max(maxErr, Math.abs(chebEval(c32, u[i]) - vals[i]));
    }
  }
  return { firstJd: startJd, coeffs, count, maxErr };
}

async function main() {
  const onlyArg = process.argv.indexOf('--only');
  const only = onlyArg > 0 ? process.argv[onlyArg + 1].split(',') : null;
  const samples = new Map();
  for (const body of BODIES) {
    if (only && !only.includes(body.id)) continue;
    console.log(`Sampling ${body.id} every ${body.step}`);
    samples.set(body.id, await fetchSamples(body));
  }
  if (only) {
    console.log('Fetched subset only; run without --only to write chunks.');
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const manifest = {
    source: 'JPL Horizons (DE440), geometric states; Chebyshev fit by tools/build-ephemeris.mjs',
    frame: 'ecliptic J2000 (IAU 2006 obliquity), km, TDB',
    bodies: BODIES.map(({ id, command, center, L, N }) => ({ id, horizons: command, center, segmentDays: L, degree: N })),
    blocks: [],
  };
  const errors = {};
  for (let bi = 0; bi < BLOCKS.length - 1; bi++) {
    const [year, start] = BLOCKS[bi];
    const end = BLOCKS[bi + 1][1];
    const fits = BODIES.map((body) => {
      const f = fitBlock(samples.get(body.id), body, start, end);
      errors[body.id] = Math.max(errors[body.id] ?? 0, f.maxErr);
      return { body, ...f };
    });
    const dirBytes = 32 * fits.length;
    let offset = 32 + dirBytes;
    const total = offset + fits.reduce((s, f) => s + f.coeffs.byteLength, 0);
    const buf = Buffer.alloc(total);
    buf.write('SVE1', 0, 'ascii');
    buf.writeUInt32LE(1, 4);
    buf.writeUInt32LE(fits.length, 8);
    buf.writeDoubleLE(start, 16);
    buf.writeDoubleLE(end, 24);
    fits.forEach((f, i) => {
      const d = 32 + i * 32;
      buf.write(f.body.id.padEnd(8, '\0'), d, 'ascii');
      buf.writeUInt32LE(f.body.L, d + 8);
      buf.writeUInt32LE(f.body.N, d + 12);
      buf.writeUInt32LE(f.count, d + 16);
      buf.writeUInt32LE(offset, d + 20);
      buf.writeDoubleLE(f.firstJd, d + 24);
      Buffer.from(f.coeffs.buffer).copy(buf, offset);
      offset += f.coeffs.byteLength;
    });
    const file = `de440-${year}-${year + 50}.bin`;
    writeFileSync(resolve(outDir, file), buf);
    manifest.blocks.push({ file, startJd: start, endJd: end, startYear: year, endYear: year + 50, bytes: total });
    console.log(`Wrote ${file} (${(total / 1e6).toFixed(2)} MB)`);
  }
  manifest.maxFitErrorKm = Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, Number(v.toFixed(4))]));
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Max fit error (km):', manifest.maxFitErrorKm);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
