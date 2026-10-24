#!/usr/bin/env node
// Builds exoplanets.json from the NASA Exoplanet Archive's Planetary Systems
// Composite Parameters table (pscomppars): one entry per host system with
// its planets' orbits and sizes. Systems without a distance are skipped.
//
// Output: { columns, systems: [[host, ra, dec, distPc, vmag, spect, teff, radSun,
//            massSun, logLum, starCount, [planet rows…]], …] }
//   planet row: [name, periodDays, aAU, ecc, inclDeg, argPeriDeg, transitMidJd,
//                radiusEarth, massEarth, eqTempK, discYear, method, facility]
//   (null where unknown)
//
// Usage: node tools/build-exoplanets.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dataOut, download, num } from './lib.mjs';

const COLUMNS = [
  'pl_name', 'hostname', 'sy_snum', 'ra', 'dec', 'sy_dist', 'sy_vmag', 'st_spectype', 'st_teff', 'st_rad', 'st_mass',
  'st_lum', 'pl_orbper', 'pl_orbsmax', 'pl_orbeccen', 'pl_orbincl', 'pl_orblper', 'pl_tranmid', 'pl_rade', 'pl_bmasse',
  'pl_eqt', 'disc_year', 'discoverymethod', 'disc_facility',
];
const query = `select ${COLUMNS.join(',')} from pscomppars`;
const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?${new URLSearchParams({ query, format: 'csv' })}`;

/** Minimal RFC 4180 CSV parser (quoted fields with commas). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const path = await download(url, 'exoplanets-pscomppars-v1.csv');
const [header, ...rows] = parseCsv(readFileSync(path, 'utf8')).filter((r) => r.length > 1);
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const val = (r, c) => {
  const v = num(r[col[c]]);
  return Number.isFinite(v) ? v : null;
};
const round = (v, digits) => (v === null ? null : Number(v.toPrecision(digits)));

const systems = new Map();
let skipped = 0;
for (const r of rows) {
  const dist = val(r, 'sy_dist');
  if (dist === null) { skipped++; continue; }
  const host = r[col.hostname];
  let s = systems.get(host);
  if (!s) {
    s = [
      host, round(val(r, 'ra'), 9), round(val(r, 'dec'), 9), round(dist, 6), round(val(r, 'sy_vmag'), 4),
      r[col.st_spectype] || null, round(val(r, 'st_teff'), 4), round(val(r, 'st_rad'), 4), round(val(r, 'st_mass'), 4),
      round(val(r, 'st_lum'), 4), val(r, 'sy_snum'), [],
    ];
    systems.set(host, s);
  }
  s[11].push([
    r[col.pl_name], round(val(r, 'pl_orbper'), 9), round(val(r, 'pl_orbsmax'), 6), round(val(r, 'pl_orbeccen'), 4),
    round(val(r, 'pl_orbincl'), 5), round(val(r, 'pl_orblper'), 5), round(val(r, 'pl_tranmid'), 12),
    round(val(r, 'pl_rade'), 4), round(val(r, 'pl_bmasse'), 5), round(val(r, 'pl_eqt'), 4), val(r, 'disc_year'),
    r[col.discoverymethod] || null, r[col.disc_facility] || null,
  ]);
}
// Planets in each system by orbit size; systems by distance.
for (const s of systems.values()) s[11].sort((a, b) => (a[2] ?? a[1] ?? 0) - (b[2] ?? b[1] ?? 0));
const list = [...systems.values()].sort((a, b) => a[3] - b[3]);

writeFileSync(resolve(dataOut, 'exoplanets.json'), JSON.stringify({
  source: 'NASA Exoplanet Archive, Planetary Systems Composite Parameters',
  retrieved: new Date().toISOString().slice(0, 10),
  systems: list,
}));
const planets = list.reduce((n, s) => n + s[11].length, 0);
console.log(`${list.length} systems, ${planets} planets (${skipped} planets without a distance skipped).`);
console.log(`Nearest: ${list.slice(0, 5).map((s) => `${s[0]} ${s[3]} pc`).join(', ')}`);
