#!/usr/bin/env node
// Converts NASA SVS "Deep Star Maps 2020" Milky Way background (Ernie Wright,
// NASA/GSFC SVS; Gaia DR2: ESA/Gaia/DPAC) into web-friendly JPEGs.
//
// The source is an 8192×4096 half-float OpenEXR in plate carrée, ICRS RA/Dec,
// containing the diffuse light of the ~1.7 billion stars *fainter* than the
// Hipparcos/Tycho catalogues — exactly the part our point-star layers don't draw.
//
// Output (apps/web/public/data/milkyway/):
//   milkyway-4k.jpg   north-up, gamma-encoded: v = (L·scale)^(1/2.2) (the 8k version is 15 MB of
//                     mostly resolved faint stars, not worth shipping)
//   milkyway.json     { scale, gamma } to decode linear L = v^gamma / scale
// Column 0 is RA = 180°, RA increasing to the LEFT (centre column RA = 0°), as verified against the
// Magellanic Clouds' positions.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { FloatType } from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { dataOut, download, resolve } from './lib.mjs';

const GAMMA = 2.2;

/** three's EXRLoader returns rows bottom-up (GL convention); output images are north-up. */
function downsample(src, w, h, factor) {
  const W = w / factor, H = h / factor;
  const out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((h - 1 - (y * factor + dy)) * w + (x * factor + dx)) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2];
        }
      }
      const k = factor * factor, o = (y * W + x) * 3;
      out[o] = r / k; out[o + 1] = g / k; out[o + 2] = b / k;
    }
  }
  return { data: out, w: W, h: H };
}

function encode({ data, w, h }, scale, quality) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    for (let c = 0; c < 3; c++) rgba[j + c] = Math.round(Math.min(1, Math.max(0, data[i + c] * scale)) ** (1 / GAMMA) * 255);
    rgba[j + 3] = 255;
  }
  return jpeg.encode({ data: rgba, width: w, height: h }, quality).data;
}

async function main() {
  const src = await download('https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k.exr', 'milkyway_2020_8k.exr');
  const buf = readFileSync(src);
  const loader = new EXRLoader().setDataType(FloatType);
  const exr = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { width: w, height: h, data } = exr;
  console.log(`EXR ${w}×${h}, ${exr.format === 1023 ? 'RGBA' : exr.format}`);

  // Normalise so the 99.95th-percentile luminance maps to 1 (a few bright clumps clip).
  const lum = [];
  for (let i = 0; i < data.length; i += 4 * 37) lum.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
  lum.sort((a, b) => a - b);
  const p = lum[Math.floor(lum.length * 0.9995)];
  const scale = 1 / p;

  const outDir = resolve(dataOut, 'milkyway');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'milkyway-4k.jpg'), encode(downsample(data, w, h, 2), scale, 90));
  writeFileSync(resolve(outDir, 'milkyway.json'), JSON.stringify({ scale, gamma: GAMMA, raAtLeftEdge: 180, source: 'NASA/GSFC SVS Deep Star Maps 2020 (#4851)' }));
  console.log(`scale ${scale.toExponential(3)}; wrote milkyway-4k.jpg`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
