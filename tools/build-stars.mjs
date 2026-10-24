#!/usr/bin/env node
// Converts the HYG v4.1 CSV (CC BY-SA 4.0, astronexus/HYG-Database) into the
// compact binary star catalog bundled with the app.
//
// Output (little-endian):
//   header  : 'SVS1' magic, uint32 count, uint32 floatsPerStar, uint32 reserved
//   records : float32 x, y, z (parsecs, ICRS equatorial, Sun-centred),
//             float32 absMag, float32 colorIndex (B-V), float32 flags
// Records are sorted by apparent magnitude from the Sun (brightest first), so a
// renderer can draw a prefix of the buffer as a magnitude-limited LOD.
// flags bit 0: distance unknown; star placed at PLACEHOLDER_DIST_PC.

import { createReadStream, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_URL = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';
const src = resolve(root, '.cache/raw/hygdata_v41.csv');
const outDir = resolve(root, 'apps/web/public/data');

const FLOATS_PER_STAR = 6;
const HYG_UNKNOWN_DIST = 100000; // HYG uses 100000 pc for "no usable parallax"
const PLACEHOLDER_DIST_PC = 1000;
const DEFAULT_CI = 0.65; // roughly solar; used when B-V is missing

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function main() {
  if (!existsSync(src)) {
    mkdirSync(dirname(src), { recursive: true });
    console.log(`Downloading ${SRC_URL}`);
    const res = await fetch(SRC_URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    writeFileSync(src, Buffer.from(await res.arrayBuffer()));
  }

  const rl = createInterface({ input: createReadStream(src), crlfDelay: Infinity });
  let cols = null;
  const stars = [];
  for await (const line of rl) {
    if (!line) continue;
    const f = parseCsvLine(line);
    if (!cols) { cols = Object.fromEntries(f.map((name, i) => [name, i])); continue; }
    const get = (k) => f[cols[k]];
    if (get('proper') === 'Sol') continue;

    let dist = Number(get('dist'));
    let x = Number(get('x')), y = Number(get('y')), z = Number(get('z'));
    const mag = Number(get('mag'));
    let absMag = Number(get('absmag'));
    let flags = 0;
    if (!(dist > 0) || dist >= HYG_UNKNOWN_DIST) {
      // Keep the true direction and apparent magnitude; invent a distance.
      const s = PLACEHOLDER_DIST_PC / Math.hypot(x, y, z);
      x *= s; y *= s; z *= s;
      dist = PLACEHOLDER_DIST_PC;
      absMag = mag - 5 * Math.log10(dist / 10);
      flags |= 1;
    }
    const ciRaw = get('ci');
    const ci = ciRaw === '' ? DEFAULT_CI : Number(ciRaw);
    if (![x, y, z, absMag, mag, ci].every(Number.isFinite)) continue;

    stars.push({
      x, y, z, absMag, ci, flags, mag,
      proper: get('proper'),
      bayer: get('bayer'),
      flam: get('flam'),
      con: get('con'),
      hip: get('hip'),
      spect: get('spect'),
      dist,
    });
  }

  stars.sort((a, b) => a.mag - b.mag);

  const header = 16;
  const buf = Buffer.alloc(header + stars.length * FLOATS_PER_STAR * 4);
  buf.write('SVS1', 0, 'ascii');
  buf.writeUInt32LE(stars.length, 4);
  buf.writeUInt32LE(FLOATS_PER_STAR, 8);
  const f32 = new Float32Array(buf.buffer, buf.byteOffset + header, stars.length * FLOATS_PER_STAR);
  const names = [];
  stars.forEach((s, i) => {
    f32.set([s.x, s.y, s.z, s.absMag, s.ci, s.flags], i * FLOATS_PER_STAR);
    if (s.proper || s.bayer || s.flam) {
      names.push({
        i,
        name: s.proper || undefined,
        bayer: s.bayer || undefined,
        flam: s.flam ? Number(s.flam) : undefined,
        con: s.con || undefined,
        hip: s.hip ? Number(s.hip) : undefined,
        spect: s.spect || undefined,
      });
    }
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'stars-hyg.bin'), buf);
  writeFileSync(resolve(outDir, 'stars-hyg-names.json'), JSON.stringify(names));
  const unknown = stars.filter((s) => s.flags & 1).length;
  console.log(
    `Wrote ${stars.length} stars (${(buf.length / 1e6).toFixed(2)} MB), ` +
      `${names.length} named, ${unknown} with placeholder distance.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
