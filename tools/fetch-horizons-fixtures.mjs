#!/usr/bin/env node
// Fetches reference state vectors from the JPL Horizons API and writes them as
// test fixtures for @simuverse/astro. Vectors are geometric, ecliptic J2000,
// in AU (and AU/day), at TDB epochs. Re-run only when adding bodies/epochs.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'packages/astro/src/__fixtures__/horizons.json');

// Horizons body ids; planets use the body itself, not the barycentre.
const BODIES = {
  mercury: '199', venus: '299', earth: '399', mars: '499',
  jupiter: '599', saturn: '699', uranus: '799', neptune: '899',
};
const EPOCHS_JD_TDB = [2433282.5, 2451545.0, 2460000.5, 2469807.5];

async function vectors(command, center, jd) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${command}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'${center}'`,
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'J2000',
    OUT_UNITS: 'AU-D',
    VEC_TABLE: '2',
    VEC_CORR: 'NONE',
    CSV_FORMAT: 'YES',
    TLIST: `'${jd}'`,
    TLIST_TYPE: 'JD',
  });
  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`);
  const body = await res.json();
  const block = body.result.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!block) throw new Error(`No vectors for ${command} @ ${jd}:\n${body.result}`);
  // CSV row: JDTDB, Calendar, X, Y, Z, VX, VY, VZ,
  const f = block.trim().split(',').map((s) => s.trim());
  const [x, y, z, vx, vy, vz] = f.slice(2, 8).map(Number);
  return { jdTdb: Number(f[0]), r: [x, y, z], v: [vx, vy, vz] };
}

const fixtures = {
  source: 'JPL Horizons API (https://ssd.jpl.nasa.gov/horizons/), geometric states, ecliptic J2000, AU and AU/day',
  fetched: new Date().toISOString().slice(0, 10),
  heliocentric: {},
  moonGeocentric: [],
};

for (const [name, id] of Object.entries(BODIES)) {
  fixtures.heliocentric[name] = [];
  for (const jd of EPOCHS_JD_TDB) {
    fixtures.heliocentric[name].push(await vectors(id, '500@10', jd));
  }
  console.log(`fetched ${name}`);
}
for (const jd of EPOCHS_JD_TDB) {
  fixtures.moonGeocentric.push(await vectors('301', '500@399', jd));
}

writeFileSync(out, JSON.stringify(fixtures, null, 2) + '\n');
console.log(`Wrote ${out}`);
