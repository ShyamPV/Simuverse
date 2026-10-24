#!/usr/bin/env node
// Builds sky-registered images of deep-sky objects from survey data (CDS hips2fits cutouts):
//
//  - Nebulae (for rendering and for the Explore catalogue): a starless,
//    background-subtracted texture (north up, east left, known field of view)
//    plus the original-looking photo, and a 128 px tile in a texture atlas
//    used by the billboards.
//  - Star clusters and bright named galaxies: the photo only (Explore).
//
// Sources, chosen per object by coverage and licence:
//   VPHAS+ DR4 (ESO, CC BY 4.0)       southern Galactic plane: H-alpha → red, g → blue
//   Pan-STARRS1 DR1 (STScI, royalty-free with acknowledgement)  dec > −30°: r → red, g → blue
//   DECaPS2 (NOIRLab)                 southern Galactic plane fallback: r → red, g → blue
// Saturated or missing pixels (CCD gaps, the cores of the brightest nebulae)
// are inpainted from their surroundings. Objects with no coverage get no image.
//
// Output: apps/web/public/data/images/{index.json, atlas.jpg, render/*.jpg, photo/*.jpg}
// Usage:  node tools/build-images.mjs [--only "NGC 1976,M31"] [--limit 20]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { dataOut, root } from './lib.mjs';

const cacheDir = resolve(root, '.cache/hips');
const outDir = resolve(dataOut, 'images');
const SIZE = 384;
/** Nebulae wider than this (field of view, arcmin) come from whole-sky H-alpha maps. */
const LARGE_ARCMIN = 25;
const TILE = 128;
const ATLAS_COLS = 16;
const MAX_NEBULAE = ATLAS_COLS * ATLAS_COLS;
const CONCURRENCY = 3;

const SURVEYS = {
  vphas: { red: 'CDS/P/VPHAS/DR4/Halpha', blue: 'CDS/P/VPHAS/DR4/g', credit: 'VPHAS+ DR4 (ESO, CC BY 4.0) via CDS hips2fits', redIsHa: true },
  ps1: { red: 'CDS/P/PanSTARRS/DR1/r', blue: 'CDS/P/PanSTARRS/DR1/g', credit: 'Pan-STARRS1 DR1 (STScI/MAST) via CDS hips2fits', redIsHa: false },
  decaps: { red: 'CDS/P/DECaPS/DR2/r', blue: 'CDS/P/DECaPS/DR2/g', credit: 'DECaPS2 (Saydjari et al. 2023; NSF NOIRLab/CTIO, DECam) via CDS hips2fits', redIsHa: false },
};

const HALPHA = {
  shassa: { hips: "CDS/P/SHASSA/H", credit: "SHASSA H-alpha (Gaustad et al. 2001, Swarthmore College) via CDS hips2fits" },
  vtss: { hips: "CDS/P/VTSS/Ha", credit: "VTSS H-alpha (Dennison et al. 1998, Virginia Tech) via CDS hips2fits" },
  finkbeiner: { hips: "CDS/P/Finkbeiner", credit: "Full-sky H-alpha composite (Finkbeiner 2003) via CDS hips2fits" },
};

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',').map((s) => s.trim())) : null;
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

// ---------------------------------------------------------------- targets

const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const deepsky = JSON.parse(readFileSync(resolve(dataOut, 'deepsky.json'), 'utf8'));
const NEBULA = /^(HII|EmN|Neb|RfN|PN|SNR|Cl\+N)$/;

const nebulae = deepsky
  .filter((o) => NEBULA.test(o.type) && o.majAx && (o.majAx >= 2 || (o.type === 'PN' && o.majAx >= 0.3) || o.messier))
  .map((o) => ({
    ref: o.id, name: o.name, kind: 'nebula', ra: o.ra, dec: o.dec,
    fov: Math.min(Math.max((o.majAx * 1.35) / 60, 0.01), 8),
    priority: (o.messier ? 1000 : 0) + (o.distPc ? 500 : 0) + Math.log10(o.majAx) * 50 - (o.mag ?? 12) * 5,
  }))
  .sort((a, b) => b.priority - a.priority)
  .slice(0, MAX_NEBULAE);

const clusters = deepsky
  .filter((o) => /Cl|Ass/.test(o.type) && !NEBULA.test(o.type) && o.majAx && (o.messier || ((o.mag ?? 99) < 6.5 && o.majAx >= 8)))
  .map((o) => ({ ref: o.id, name: o.name, kind: 'cluster', ra: o.ra, dec: o.dec, fov: Math.min(Math.max((o.majAx * 1.5) / 60, 0.05), 4) }));

function readGalaxies() {
  const buf = readFileSync(resolve(dataOut, 'galaxies.bin'));
  const count = buf.readUInt32LE(4), stride = buf.readUInt32LE(8);
  const names = JSON.parse(readFileSync(resolve(dataOut, 'galaxy-names.json'), 'utf8'));
  const out = [];
  for (const n of names) {
    const o = 16 + n.i * stride * 4;
    const f = (k) => buf.readFloatLE(o + k * 4);
    const [x, y, z] = [f(0), f(1), f(2)];
    const d = Math.hypot(x, y, z);
    const appV = f(10);
    if (!(appV < 10.5) || /Magellanic|Sagittarius dSph/.test(n.name)) continue;
    const radiusDeg = ((f(4) / 1000) / d) * (180 / Math.PI);
    out.push({
      ref: n.name, name: n.name, kind: 'galaxy', ra: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
      dec: (Math.asin(z / d) * 180) / Math.PI, fov: Math.min(Math.max(radiusDeg * 2.6, 0.04), 5),
    });
  }
  void count;
  return out;
}

let targets = [...nebulae, ...clusters, ...readGalaxies()];
if (only) targets = targets.filter((t) => only.has(t.ref) || only.has(t.name));
targets = targets.slice(0, limit);

// ---------------------------------------------------------------- fetching

async function cutout(hips, t) {
  const dir = resolve(cacheDir, hips.replace(/\//g, '_'));
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${slug(t.ref)}-${SIZE}.fits`);
  if (!existsSync(file)) {
    const params = new URLSearchParams({
      hips, width: String(SIZE), height: String(SIZE), fov: String(t.fov), projection: 'TAN', coordsys: 'icrs',
      ra: String(t.ra), dec: String(t.dec), format: 'fits',
    });
    for (let attempt = 0; ; attempt++) {
      let status = 'network error';
      try {
        const res = await fetch(`https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${params}`);
        if (res.ok) {
          writeFileSync(file, Buffer.from(await res.arrayBuffer()));
          break;
        }
        status = `HTTP ${res.status}`;
      } catch (err) {
        status = err.message;
      }
      if (attempt >= 4) throw new Error(`${hips} ${t.ref}: ${status}`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  return readFits(file);
}

/** Minimal FITS reader for hips2fits output (one 2-D HDU, any BITPIX, BSCALE/BZERO/BLANK); rows top-down. */
function readFits(file) {
  const buf = readFileSync(file);
  const kw = {};
  let off = 0, done = false;
  while (!done) {
    for (let i = 0; i < 36; i++) {
      const card = buf.toString('latin1', off + i * 80, off + i * 80 + 80);
      if (card.startsWith('END')) done = true;
      else if (card[8] === '=') kw[card.slice(0, 8).trim()] = card.slice(10, 80).split('/')[0].trim();
    }
    off += 2880;
  }
  const w = Number(kw.NAXIS1), h = Number(kw.NAXIS2), bitpix = Number(kw.BITPIX);
  const scale = kw.BSCALE ? Number(kw.BSCALE) : 1, zero = kw.BZERO ? Number(kw.BZERO) : 0;
  const blank = kw.BLANK !== undefined ? Number(kw.BLANK) : null;
  const bytes = Math.abs(bitpix) / 8;
  const read = {
    8: (o) => buf.readUInt8(o), 16: (o) => buf.readInt16BE(o), 32: (o) => buf.readInt32BE(o),
    '-32': (o) => buf.readFloatBE(o), '-64': (o) => buf.readDoubleBE(o),
  }[bitpix];
  if (!read) throw new Error(`Unsupported BITPIX ${bitpix} in ${file}`);
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const raw = read(off + ((h - 1 - y) * w + x) * bytes);
      // Blank, NaN and exact zero all mean "no data" in these HiPS.
      data[y * w + x] = raw === blank || !Number.isFinite(raw) || raw === 0 ? NaN : raw * scale + zero;
    }
  }
  return { w, h, data };
}

// ---------------------------------------------------------------- image processing

function percentile(arr, p) {
  const s = Float32Array.from(arr.filter(Number.isFinite)).sort();
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0;
}

/** Median filter (square window, radius r), ignoring NaN. */
function median(img, w, h, r) {
  const out = new Float32Array(w * h);
  const win = new Float32Array((2 * r + 1) ** 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const v = img[yy * w + xx];
          if (Number.isFinite(v)) win[n++] = v;
        }
      }
      if (!n) { out[y * w + x] = NaN; continue; }
      const s = win.subarray(0, n).sort();
      out[y * w + x] = s[n >> 1];
    }
  }
  return out;
}

/**
 * Fills NaN pixels from their surroundings: a coarse-to-fine pyramid gives
 * large holes (CCD gaps, saturated cores) a smooth starting value, then
 * Laplace relaxation blends it in.
 */
function inpaint(img, w, h) {
  const holes = [];
  for (let i = 0; i < w * h; i++) if (!Number.isFinite(img[i])) holes.push(i);
  if (!holes.length) return img;
  // Pyramid of block means of valid pixels.
  const levels = [{ w, h, d: img }];
  while (levels.at(-1).w > 4) {
    const p = levels.at(-1);
    const nw = Math.ceil(p.w / 2), nh = Math.ceil(p.h / 2);
    const d = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let s = 0, n = 0;
      for (let k = 0; k < 4; k++) {
        const xx = 2 * x + (k & 1), yy = 2 * y + (k >> 1);
        if (xx < p.w && yy < p.h && Number.isFinite(p.d[yy * p.w + xx])) { s += p.d[yy * p.w + xx]; n++; }
      }
      d[y * nw + x] = n ? s / n : NaN;
    }
    levels.push({ w: nw, h: nh, d });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const p = levels[l], c = levels[l + 1];
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x;
      if (!Number.isFinite(p.d[i])) p.d[i] = c.d[(y >> 1) * c.w + (x >> 1)];
    }
  }
  const out = levels[0].d;
  for (let it = 0; it < 120; it++) {
    for (const i of holes) {
      const x = i % w, y = (i / w) | 0;
      let s = 0, n = 0;
      if (x > 0) { s += out[i - 1]; n++; }
      if (x < w - 1) { s += out[i + 1]; n++; }
      if (y > 0) { s += out[i - w]; n++; }
      if (y < h - 1) { s += out[i + w]; n++; }
      out[i] = s / n;
    }
  }
  return out;
}

/** Removes point sources: pixels well above a local median, dilated, then inpainted. */
function removeStars(img, w, h) {
  let cur = Float32Array.from(img);
  for (const r of [2, 5]) {
    const m = median(cur, w, h, r);
    const resid = cur.map((v, i) => v - m[i]);
    const sigma = 1.4826 * percentile(resid.map(Math.abs), 0.5) || 1e-6;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const excess = resid[i] / sigma;
      if (!(excess > 5)) continue;
      // Brighter stars get bigger halos.
      const grow = Math.min(1 + Math.floor(Math.log2(excess / 5)), r + 2);
      for (let dy = -grow; dy <= grow; dy++) for (let dx = -grow; dx <= grow; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h && dx * dx + dy * dy <= grow * grow) mask[yy * w + xx] = 1;
      }
    }
    cur = cur.map((v, i) => (mask[i] ? NaN : v));
    cur = inpaint(cur, w, h);
  }
  return cur;
}

/** Removes horizontal bleed trails of saturated stars: thin ones, then thick long ones. */
function removeStreaks(img, w, h) {
  return streakPass(streakPass(removePlateaus(img, w, h), w, h, 9, 8), w, h, 24, 48);
}

/**
 * Saturation plateaus: horizontal runs (≥ 20 px) at the field's maximum, as
 * left by the brightest nebula cores (M42). Each column is refilled by
 * interpolating between the nearest good rows above and below.
 */
function removePlateaus(img, w, h) {
  const max = percentile(img, 1);
  const mask = new Uint8Array(w * h);
  let found = false;
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && img[y * w + x] >= 0.9 * max) run++;
      else {
        if (run >= 20) {
          found = true;
          for (let k = x - run; k < x; k++) for (let dy = -3; dy <= 3; dy++) {
            const yy = y + dy;
            if (yy >= 0 && yy < h) mask[yy * w + k] = 1;
          }
        }
        run = 0;
      }
    }
  }
  if (!found) return img;
  const out = Float32Array.from(img);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (!mask[y * w + x]) continue;
      let y0 = y;
      while (y0 >= 0 && mask[y0 * w + x]) y0--;
      let y1 = y;
      while (y1 < h && mask[y1 * w + x]) y1++;
      const a = y0 >= 0 ? img[y0 * w + x] : NaN, b = y1 < h ? img[y1 * w + x] : NaN;
      for (let yy = y0 + 1; yy < y1; yy++) {
        const t = (yy - y0) / (y1 - y0);
        out[yy * w + x] = Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : Number.isFinite(a) ? a : b;
      }
      y = y1;
    }
  }
  return out;
}

/**
 * One pass: a trail is a horizontal run (≥ minRun px) much brighter than the
 * median of the R rows above and below it.
 */
function streakPass(img, w, h, R, minRun) {
  const vmed = new Float32Array(w * h);
  const col = new Float32Array(2 * R + 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0;
    for (let dy = -R; dy <= R; dy++) {
      const v = img[Math.min(Math.max(y + dy, 0), h - 1) * w + x];
      if (Number.isFinite(v)) col[n++] = v;
    }
    const s = col.subarray(0, n).sort();
    vmed[y * w + x] = n ? s[n >> 1] : NaN;
  }
  const resid = img.map((v, i) => v - vmed[i]);
  const sigma = 1.4826 * percentile(resid.map(Math.abs), 0.5) || 1e-6;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    // Runs of ≥ 8 bright pixels along a row.
    let run = 0;
    for (let x = 0; x <= w; x++) {
      const hot = x < w && resid[y * w + x] > 6 * sigma;
      if (hot) run++;
      else {
        if (run >= minRun) for (let k = x - run; k < x; k++) for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy;
          if (yy >= 0 && yy < h) mask[yy * w + k] = 1;
        }
        run = 0;
      }
    }
  }
  return inpaint(img.map((v, i) => (mask[i] ? NaN : v)), w, h);
}

/** Background-subtracted, normalised band (0 = sky, 1 = bright nebula). */
function normalise(img, bgOf = img, bgPct = 0.12) {
  // bgPct null: already sky-subtracted (black-pointed); keep zero as the sky level.
  const bg = bgPct === null ? 0 : percentile(bgOf, bgPct);
  const hi = percentile(img, 0.997);
  const scale = Math.max(hi - bg, 1e-9);
  return img.map((v) => (v - bg) / scale);
}

/** Subtracts the noise floor so a starless texture's sky is black, not speckled. */
function blackPoint(img, bgOf, w, h) {
  // Sky from the outer ring of the field (the object is framed in the middle), so
  // nebulae that fill most of the cutout keep their faint outer parts.
  const ring = bgOf.filter((_, i) => Math.hypot((i % w + 0.5) / w - 0.5, (Math.floor(i / w) + 0.5) / h - 0.5) > 0.42);
  const bg = percentile(ring, 0.4);
  const noise = 1.4826 * percentile(ring.map((v) => Math.abs(v - bg)), 0.5);
  return img.map((v) => v - bg - 3 * noise);
}

const asinh = (x, k) => Math.asinh(Math.max(x, 0) * k) / Math.asinh(k);

/** Red/blue bands → RGB. With H-alpha as red the nebula is pinker; broadband r is warmer. */
function compose(red, blue, redIsHa, k) {
  const n = red.length;
  const px = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const R = red[i], B = blue[i];
    const r = R, g = redIsHa ? 0.18 * R + 0.55 * B : 0.42 * R + 0.5 * B, b = redIsHa ? 0.2 * R + 0.95 * B : 0.08 * R + 0.95 * B;
    px[i * 4] = Math.min(255, Math.round(255 * asinh(r, k)));
    px[i * 4 + 1] = Math.min(255, Math.round(255 * asinh(g, k)));
    px[i * 4 + 2] = Math.min(255, Math.round(255 * asinh(b, k)));
    px[i * 4 + 3] = 255;
  }
  return px;
}

/**
 * H-alpha only → emission colours: deep pink-red, whitening towards the
 * brightest (hottest, [O III]-bright) parts as in colour photographs.
 */
function colouriseHalpha(a, k) {
  const n = a.length;
  const px = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = asinh(a[i], k);
    const core = Math.min(Math.max((v - 0.6) / 0.4, 0), 1);
    px[i * 4] = Math.min(255, Math.round(255 * v));
    px[i * 4 + 1] = Math.min(255, Math.round(255 * v * (0.3 + 0.55 * core)));
    px[i * 4 + 2] = Math.min(255, Math.round(255 * v * (0.42 + 0.5 * core)));
    px[i * 4 + 3] = 255;
  }
  return px;
}

/** Soft circular vignette so the square cutout has no edges in 3D. */
function vignette(px, w, h) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.hypot((x + 0.5) / w - 0.5, (y + 0.5) / h - 0.5) * 2;
    const t = Math.min(Math.max((r - 0.78) / 0.22, 0), 1);
    const f = 1 - t * t * (3 - 2 * t);
    for (let c = 0; c < 3; c++) px[(y * w + x) * 4 + c] = Math.round(px[(y * w + x) * 4 + c] * f);
  }
  return px;
}

function downsample(px, w, h, size) {
  const out = new Uint8Array(size * size * 4);
  const f = w / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    for (let c = 0; c < 4; c++) {
      let s = 0, n = 0;
      for (let yy = Math.floor(y * f); yy < Math.floor((y + 1) * f); yy++) {
        for (let xx = Math.floor(x * f); xx < Math.floor((x + 1) * f); xx++) { s += px[(yy * w + xx) * 4 + c]; n++; }
      }
      out[(y * size + x) * 4 + c] = Math.round(s / n);
    }
  }
  return out;
}

const blankFraction = (img) => img.reduce((n, v) => n + (Number.isFinite(v) ? 0 : 1), 0) / img.length;

/** Broadband pair from the first survey with usable coverage (≤ 35% blank in both bands). */
async function bands(t) {
  const order = t.dec > -29.5 ? ['ps1', 'vphas', 'decaps'] : ['vphas', 'decaps'];
  for (const key of order) {
    const s = SURVEYS[key];
    try {
      const red = await cutout(s.red, t);
      if (blankFraction(red.data) > 0.35) continue;
      const blue = await cutout(s.blue, t);
      if (blankFraction(blue.data) > 0.35) continue;
      return { survey: key, red, blue };
    } catch (err) {
      console.warn(`  ${t.ref}: ${key} failed (${err.message})`);
    }
  }
  return null;
}

/** Whole-sky H-alpha map for large nebulae: SHASSA in the south, VTSS in the north, Finkbeiner otherwise. */
async function halpha(t) {
  const order = t.dec < -15 ? ['shassa', 'vtss', 'finkbeiner'] : ['vtss', 'shassa', 'finkbeiner'];
  for (const key of order) {
    try {
      const img = await cutout(HALPHA[key].hips, t);
      if (blankFraction(img.data) <= 0.2) return { survey: key, img };
    } catch (err) {
      console.warn(`  ${t.ref}: ${key} failed (${err.message})`);
    }
  }
  return null;
}

// ---------------------------------------------------------------- main

mkdirSync(resolve(outDir, 'render'), { recursive: true });
mkdirSync(resolve(outDir, 'photo'), { recursive: true });
const indexPath = resolve(outDir, 'index.json');
const previous = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { objects: {} };
const atlas = new Uint8Array(ATLAS_COLS * TILE * ATLAS_COLS * TILE * 4);
const objects = only ? { ...previous.objects } : {};
let nextSlot = only ? Math.max(-1, ...Object.values(objects).map((o) => o.slot ?? -1)) + 1 : 0;

/** Writes a nebula's render texture and atlas tile; returns its slot and mean brightness. */
function addRender(px, w, h, file) {
  writeFileSync(resolve(outDir, 'render', file), jpeg.encode({ data: px, width: w, height: h }, 85).data);
  let sum = 0;
  // Mean in linear light: the renderer decodes these JPEGs as sRGB.
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  for (let i = 0; i < w * h; i++) sum += (lin(px[i * 4]) + lin(px[i * 4 + 1]) + lin(px[i * 4 + 2])) / 3;
  const slot = nextSlot++;
  const tile = downsample(px, w, h, TILE);
  const ax = (slot % ATLAS_COLS) * TILE, ay = Math.floor(slot / ATLAS_COLS) * TILE;
  for (let y = 0; y < TILE; y++) atlas.set(tile.subarray(y * TILE * 4, (y + 1) * TILE * 4), ((ay + y) * ATLAS_COLS * TILE + ax) * 4);
  return { slot, mean: Number((sum / (w * h)).toFixed(4)) };
}

async function processTarget(t) {
  const file = `${slug(t.ref)}.jpg`;
  // Large nebulae: deep CCD surveys subtract extended emission and saturate, so use H-alpha maps.
  if (t.kind === 'nebula' && t.fov * 60 > LARGE_ARCMIN) {
    const ha = await halpha(t);
    if (!ha) {
      console.log(`  ${t.ref.padEnd(14)} no H-alpha coverage`);
      return;
    }
    const { w, h } = ha.img;
    const clean = removeStreaks(inpaint(ha.img.data, w, h), w, h);
    writeFileSync(resolve(outDir, 'photo', file), jpeg.encode({ data: colouriseHalpha(normalise(clean, clean, 0.25), 6), width: w, height: h }, 82).data);
    const starless = removeStars(clean, w, h);
    const px = vignette(colouriseHalpha(normalise(blackPoint(starless, starless, w, h), undefined, null), 4), w, h);
    objects[t.ref] = {
      name: t.name, kind: t.kind, file, fov: Number(t.fov.toFixed(5)), survey: ha.survey, credit: HALPHA[ha.survey].credit,
      halpha: true, ...addRender(px, w, h, file),
    };
    console.log(`  ${t.ref.padEnd(14)} ${t.kind.padEnd(8)} ${ha.survey.padEnd(10)} fov ${(t.fov * 60).toFixed(1)}′`);
    return;
  }
  const b = await bands(t);
  if (!b) {
    console.log(`  ${t.ref.padEnd(14)} no survey coverage`);
    return;
  }
  const { w, h } = b.red;
  const s = SURVEYS[b.survey];
  const red = inpaint(b.red.data, w, h), blue = inpaint(b.blue.data, w, h);
  // Photo: stars kept, sky level from the darker third of the field.
  const photo = compose(normalise(red, red, 0.3), normalise(blue, blue, 0.3), s.redIsHa, 10);
  writeFileSync(resolve(outDir, 'photo', file), jpeg.encode({ data: photo, width: w, height: h }, 82).data);
  const entry = { name: t.name, kind: t.kind, file, fov: Number(t.fov.toFixed(5)), survey: b.survey, credit: s.credit };
  if (t.kind === 'nebula') {
    // Render texture: starless, smoothed a little, sky and noise floor removed, vignetted.
    const r0 = median(removeStars(red, w, h), w, h, 1), b0 = median(removeStars(blue, w, h), w, h, 1);
    const R = normalise(blackPoint(r0, r0, w, h), undefined, null), B = normalise(blackPoint(b0, b0, w, h), undefined, null);
    Object.assign(entry, addRender(vignette(compose(R, B, s.redIsHa, 5), w, h), w, h, file));
  }
  objects[t.ref] = entry;
  console.log(`  ${t.ref.padEnd(14)} ${t.kind.padEnd(8)} ${b.survey.padEnd(10)} fov ${(t.fov * 60).toFixed(1)}′`);
}

console.log(`${targets.length} targets`);
const queue = [...targets];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const t = queue.shift();
    try {
      await processTarget(t);
    } catch (err) {
      console.warn(`  ${t.ref}: ${err.message}`);
    }
  }
}));

if (!only) {
  for (let i = 0; i < atlas.length; i += 4) atlas[i + 3] = 255;
  writeFileSync(resolve(outDir, 'atlas.jpg'), jpeg.encode({ data: atlas, width: ATLAS_COLS * TILE, height: ATLAS_COLS * TILE }, 85).data);
}
writeFileSync(indexPath, JSON.stringify({
  version: 1, size: SIZE, tile: TILE, atlasCols: ATLAS_COLS,
  orientation: 'north up, east left; fov is the full width in degrees (gnomonic)',
  objects,
}, null, 1));
console.log(`Wrote ${Object.keys(objects).length} objects.`);
