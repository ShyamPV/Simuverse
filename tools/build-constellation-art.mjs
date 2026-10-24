/**
 * Constellation artwork from Stellarium's "modern" sky culture (illustrations by
 * Johan Meuris, Free Art License 1.3; anchor data CC BY-SA 4.0), packed into one
 * atlas with a sky mesh per figure.
 *
 * Each illustration comes with three anchor stars (HIP numbers and their pixel
 * positions). The image is mapped onto the sky by the affine transform that
 * takes those pixels to the stars' gnomonic (tangent-plane) coordinates around
 * their centroid, then tessellated and projected back onto the sphere.
 *
 * Output: data/constellation-art.jpg (atlas) and data/constellation-art.json:
 *   { tile, cols, rows, grid, figures: [{ id, slot, dirs: [x,y,z,...] }] }
 * with `dirs` the (grid+1)² vertex directions, row-major from the image's top
 * left, as J2000 equatorial unit vectors.
 */
import { inflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import { DEG, dataOut, download, readFileSync, resolve, writeFileSync, writeJson } from './lib.mjs';

const BASE = 'https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern';
const TILE = 384;
const COLS = 10;
const GRID = 12;

const index = JSON.parse(readFileSync(await download(`${BASE}/index.json`, 'stellarium-modern-index.json'), 'utf8'));

// HIP → J2000 RA/Dec from HYG (already downloaded by build-stars).
const hip = new Map();
{
  const csv = readFileSync(await download('https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv', 'hygdata_v41.csv'), 'utf8');
  const lines = csv.split('\n');
  const head = lines[0].split(',').map((h) => h.replaceAll('"', ''));
  const [iHip, iRa, iDec] = ['hip', 'ra', 'dec'].map((k) => head.indexOf(k));
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    if (f[iHip]) hip.set(Number(f[iHip]), [Number(f[iRa]) * 15, Number(f[iDec])]);
  }
}

const figures = index.constellations.filter((c) => c.image);
const rows = Math.ceil(figures.length / COLS);
const atlas = new Uint8Array(COLS * TILE * rows * TILE);
const out = [];
for (const [slot, c] of figures.entries()) {
  const id = c.id.replace('CON modern ', '');
  const file = c.image.file.split('/').pop();
  const png = decodePng(readFileSync(await download(`${BASE}/${c.image.file}`, `stellarium-art/${file}`)));
  const [w, h] = c.image.size;
  blit(png, (slot % COLS) * TILE, Math.floor(slot / COLS) * TILE);

  const anchors = c.image.anchors.map((a) => {
    const radec = hip.get(a.hip);
    if (!radec) throw new Error(`${id}: HIP ${a.hip} not in HYG`);
    return { x: a.pos[0] / w, y: a.pos[1] / h, v: unit(...radec) };
  });
  const dirs = mesh(anchors);
  if (!dirs) {
    console.warn(`${id}: anchors are collinear, skipped`);
    continue;
  }
  out.push({ id, slot, dirs: dirs.map((x) => Math.round(x * 1e5) / 1e5) });
}

const rgba = new Uint8Array(atlas.length * 4);
for (let i = 0; i < atlas.length; i++) rgba.set([atlas[i], atlas[i], atlas[i], 255], i * 4);
const jpg = jpeg.encode({ data: rgba, width: COLS * TILE, height: rows * TILE }, 82);
writeFileSync(resolve(dataOut, 'constellation-art.jpg'), jpg.data);
writeJson('constellation-art.json', {
  source: 'Stellarium modern sky culture: illustrations by Johan Meuris (Free Art License 1.3), anchors CC BY-SA 4.0',
  tile: TILE, cols: COLS, rows, grid: GRID, figures: out,
});
console.log(`${out.length} figures, atlas ${COLS * TILE}×${rows * TILE}, ${(jpg.data.length / 1e6).toFixed(2)} MB`);

// ------------------------------------------------------------------ geometry

function unit(raDeg, decDeg) {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(...a); return a.map((x) => x / l); }

/** Image (0–1, y down) → sky directions on a (GRID+1)² lattice, or null if the anchors are degenerate. */
function mesh(anchors) {
  const c = norm(anchors.reduce((s, a) => [s[0] + a.v[0], s[1] + a.v[1], s[2] + a.v[2]], [0, 0, 0]));
  const east = norm(Math.abs(c[2]) > 0.999 ? cross([1, 0, 0], c) : cross([0, 0, 1], c));
  const north = cross(c, east);
  const tan = anchors.map((a) => { const d = dot(a.v, c); return [dot(a.v, east) / d, dot(a.v, north) / d]; });
  // Solve [u v] = [x y 1] · M for the 3×2 matrix M (Cramer's rule on the 3×3 system).
  const A = anchors.map((a) => [a.x, a.y, 1]);
  const det = det3(A);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (b) => [0, 1, 2].map((k) => det3(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / det);
  const mu = solve(tan.map((t) => t[0])), mv = solve(tan.map((t) => t[1]));
  const dirs = [];
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const x = i / GRID, y = j / GRID;
      const u = mu[0] * x + mu[1] * y + mu[2], v = mv[0] * x + mv[1] * y + mv[2];
      dirs.push(...norm([c[0] + u * east[0] + v * north[0], c[1] + u * east[1] + v * north[1], c[2] + u * east[2] + v * north[2]]));
    }
  }
  return dirs;
}

function det3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

// ------------------------------------------------------------------ images

/** Area-averaged resample of a grey image into a TILE×TILE slot of the atlas (2 px black margin against mip bleed). */
function blit(img, ox, oy) {
  const inner = TILE - 4;
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const x0 = (x / inner) * img.w, x1 = ((x + 1) / inner) * img.w;
      const y0 = (y / inner) * img.h, y1 = ((y + 1) / inner) * img.h;
      let sum = 0, n = 0;
      for (let sy = Math.floor(y0); sy < Math.max(Math.floor(y0) + 1, Math.ceil(y1)); sy++) {
        for (let sx = Math.floor(x0); sx < Math.max(Math.floor(x0) + 1, Math.ceil(x1)); sx++) {
          sum += img.grey[Math.min(sy, img.h - 1) * img.w + Math.min(sx, img.w - 1)];
          n++;
        }
      }
      atlas[(oy + 2 + y) * COLS * TILE + ox + 2 + x] = Math.round(sum / n);
    }
  }
}

/** Minimal PNG decoder: 8-bit greyscale, grey+alpha, RGB, RGBA or palette, non-interlaced → grey (× alpha). */
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, type = 0, depth = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9];
      if (depth !== 8 || data[12] !== 0) throw new Error(`unsupported PNG (depth ${depth}, interlace ${data[12]})`);
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const r = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = (r + p) & 255;
    }
  }
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = px.subarray(i * channels, i * channels + channels);
    let g, alpha = 255;
    if (type === 0) g = p[0];
    else if (type === 4) { g = p[0]; alpha = p[1]; }
    else if (type === 3) { g = (palette[p[0] * 3] * 0.3 + palette[p[0] * 3 + 1] * 0.59 + palette[p[0] * 3 + 2] * 0.11); alpha = trns && p[0] < trns.length ? trns[p[0]] : 255; }
    else { g = p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11; if (type === 6) alpha = p[3]; }
    grey[i] = Math.round((g * alpha) / 255);
  }
  return { w, h, grey };
}
