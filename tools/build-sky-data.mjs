#!/usr/bin/env node
// Builds the small datasets used by Sky view:
//   constellations.json   lines, IAU boundaries and label points (d3-celestial, BSD-3-Clause)
//   cities.json           GeoNames cities ≥15k population (CC BY 4.0), for location search
//   tz-default-city.json  most populous city per IANA time zone, for a no-permission default location
//   tle-snapshot.txt      CelesTrak "visual" + "stations" groups, the offline fallback for live TLEs
//
// Usage: node tools/build-sky-data.mjs [constellations|cities|tle]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = resolve(root, '.cache/raw');
const out = resolve(root, 'apps/web/public/data');
mkdirSync(raw, { recursive: true });
mkdirSync(out, { recursive: true });

async function download(url, file) {
  const dest = resolve(raw, file);
  if (!existsSync(dest)) {
    console.log(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  return dest;
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
/** d3-celestial stores RA as a longitude in −180…180°. */
const ra = (lon) => round(lon < 0 ? lon + 360 : lon);

async function constellations() {
  const base = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/';
  const lines = JSON.parse(readFileSync(await download(base + 'constellations.lines.json', 'd3c-lines.json'), 'utf8'));
  const names = JSON.parse(readFileSync(await download(base + 'constellations.json', 'd3c-names.json'), 'utf8'));
  const bounds = JSON.parse(readFileSync(await download(base + 'constellations.bounds.json', 'd3c-bounds.json'), 'utf8'));
  const result = {};
  for (const f of names.features) {
    result[f.id] = {
      name: f.properties.name,
      genitive: f.properties.gen,
      rank: Number(f.properties.rank),
      label: [ra(f.geometry.coordinates[0]), round(f.geometry.coordinates[1])],
      lines: [],
      bounds: [],
    };
  }
  for (const f of lines.features) {
    result[f.id].lines = f.geometry.coordinates.map((l) => l.map(([lo, la]) => [ra(lo), round(la)]));
  }
  for (const f of bounds.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    // Serpens has two parts; the id may differ in case (e.g. "Ser1"); map to the 3-letter id.
    const id = Object.keys(result).find((k) => k.toLowerCase() === f.id.slice(0, 3).toLowerCase());
    if (!id) continue;
    for (const p of polys) result[id].bounds.push(p[0].map(([lo, la]) => [ra(lo), round(la)]));
  }
  writeFileSync(resolve(out, 'constellations.json'), JSON.stringify(result));
  console.log(`constellations: ${Object.keys(result).length}`);
}

async function cities() {
  const zip = await download('https://download.geonames.org/export/dump/cities15000.zip', 'cities15000.zip');
  const admin = await download('https://download.geonames.org/export/dump/admin1CodesASCII.txt', 'admin1CodesASCII.txt');
  const txt = resolve(raw, 'cities15000.txt');
  if (!existsSync(txt)) execFileSync('unzip', ['-o', zip, '-d', raw]);
  const adminNames = new Map(
    readFileSync(admin, 'utf8').split('\n').filter(Boolean).map((l) => {
      const [code, name] = l.split('\t');
      return [code, name];
    }),
  );
  const rows = [];
  for (const line of readFileSync(txt, 'utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length < 19) continue;
    const [, name, ascii, , lat, lon, , , cc, , a1] = f;
    const population = Number(f[14]);
    const dem = Number(f[16]);
    const tz = f[17];
    rows.push([name, ascii === name ? 0 : ascii, cc, adminNames.get(`${cc}.${a1}`) ?? '', round(Number(lat), 4), round(Number(lon), 4), population, Number.isFinite(dem) && dem > -1000 ? dem : 0, tz]);
  }
  rows.sort((a, b) => b[6] - a[6]);
  writeFileSync(resolve(out, 'cities.json'), JSON.stringify({ fields: ['name', 'ascii', 'country', 'admin1', 'lat', 'lon', 'population', 'elevation', 'tz'], rows }));
  const byTz = {};
  for (const r of rows) if (!byTz[r[8]]) byTz[r[8]] = r;
  writeFileSync(resolve(out, 'tz-default-city.json'), JSON.stringify(byTz));
  console.log(`cities: ${rows.length}, time zones: ${Object.keys(byTz).length}`);
}

async function tle() {
  const groups = ['stations', 'visual'];
  const seen = new Set();
  let text = '';
  for (const g of groups) {
    const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`);
    if (!res.ok) throw new Error(`CelesTrak ${g}: ${res.status}`);
    const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
    for (let i = 0; i + 2 < lines.length + 1; i += 3) {
      const id = lines[i + 1]?.slice(2, 7);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      text += `${lines[i].trim()}\n${lines[i + 1]}\n${lines[i + 2]}\n`;
    }
  }
  writeFileSync(resolve(out, 'tle-snapshot.txt'), text);
  console.log(`TLE snapshot: ${seen.size} objects`);
}

const which = process.argv[2];
if (!which || which === 'constellations') await constellations();
if (!which || which === 'cities') await cities();
if (!which || which === 'tle') await tle();
