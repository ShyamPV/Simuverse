#!/usr/bin/env node
// Fetches reference data from the JPL Horizons API and writes test fixtures
// for @simuverse/astro:
//   horizons.json          heliocentric ecliptic vectors (milestone 1 Keplerian tests)
//   horizons-observer.json validation vectors, topocentric observer tables, rise/set times
// Re-run only when adding bodies, sites or epochs.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = resolve(root, 'packages/astro/src/__fixtures__');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

async function horizons(params) {
  const res = await fetch(`${API}?${new URLSearchParams({ format: 'json', ...params })}`);
  const body = await res.json();
  const block = body.result.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!block) throw new Error(`No data:\n${body.result.slice(0, 1500)}`);
  return block.trim().split('\n').map((r) => r.split(',').map((s) => s.trim()));
}

// ---- milestone 1: heliocentric ecliptic vectors ------------------------------------------
const PLANETS = { mercury: '199', venus: '299', earth: '399', mars: '499', jupiter: '599', saturn: '699', uranus: '799', neptune: '899' };
const M1_EPOCHS = [2433282.5, 2451545.0, 2460000.5, 2469807.5];

async function eclipticVector(command, center, jd) {
  const [f] = await horizons({
    COMMAND: `'${command}'`, EPHEM_TYPE: 'VECTORS', CENTER: `'${center}'`, REF_PLANE: 'ECLIPTIC', REF_SYSTEM: 'J2000',
    OUT_UNITS: 'AU-D', VEC_TABLE: '2', VEC_CORR: 'NONE', CSV_FORMAT: 'YES', TLIST: `'${jd}'`, TLIST_TYPE: 'JD',
  });
  const [x, y, z, vx, vy, vz] = f.slice(2, 8).map(Number);
  return { jdTdb: Number(f[0]), r: [x, y, z], v: [vx, vy, vz] };
}

async function milestone1() {
  const out = {
    source: 'JPL Horizons API (https://ssd.jpl.nasa.gov/horizons/), geometric states, ecliptic J2000, AU and AU/day',
    fetched: new Date().toISOString().slice(0, 10),
    heliocentric: {},
    moonGeocentric: [],
  };
  for (const [name, id] of Object.entries(PLANETS)) {
    out.heliocentric[name] = [];
    for (const jd of M1_EPOCHS) out.heliocentric[name].push(await eclipticVector(id, '500@10', jd));
  }
  for (const jd of M1_EPOCHS) out.moonGeocentric.push(await eclipticVector('301', '500@399', jd));
  writeFileSync(resolve(fixturesDir, 'horizons.json'), JSON.stringify(out, null, 2) + '\n');
}

// ---- milestone 2 ---------------------------------------------------------------------------
// Validation epochs deliberately off the fitting grid (fractional days, spread over 1900–2100).
const VALIDATION_EPOCHS = [2415387.137, 2421000.613, 2429876.291, 2437777.777, 2444000.05, 2449123.456,
  2451545.0, 2455555.555, 2460607.2917, 2464321.98, 2474000.33, 2487900.71];
const VALIDATION_BODIES = {
  sun: ['10', '500@0'], mercury: ['199', '500@10'], venus: ['299', '500@10'], earth: ['399', '500@10'],
  mars: ['499', '500@10'], jupiter: ['599', '500@10'], saturn: ['699', '500@10'], uranus: ['799', '500@10'],
  neptune: ['899', '500@10'], pluto: ['999', '500@10'], moon: ['301', '500@399'],
};

const SITES = {
  auckland: { lon: 174.7633, lat: -36.8485, heightKm: 0.02 },
  greenwich: { lon: -0.0014, lat: 51.4778, heightKm: 0.046 },
};
const OBSERVER_BODIES = { sun: '10', moon: '301', mercury: '199', venus: '299', mars: '499', jupiter: '599', saturn: '699', uranus: '799', neptune: '899' };
const OBSERVER_TIMES_JD_UT = [2446247.770833, 2451545.25, 2460409.25, 2461337.5, 2469807.958333];

async function milestone2() {
  const out = {
    source: 'JPL Horizons API: ICRF vectors (km), observer tables (airless apparent), rise/set (TVH, refracted)',
    fetched: new Date().toISOString().slice(0, 10),
    validation: {},
    sites: SITES,
    observer: [],
    riseSet: [],
  };

  for (const [id, [command, center]] of Object.entries(VALIDATION_BODIES)) {
    const rows = await horizons({
      COMMAND: `'${command}'`, EPHEM_TYPE: 'VECTORS', CENTER: `'${center}'`, REF_PLANE: 'FRAME', REF_SYSTEM: 'ICRF',
      OUT_UNITS: 'KM-S', VEC_TABLE: '1', VEC_CORR: 'NONE', CSV_FORMAT: 'YES',
      TLIST: VALIDATION_EPOCHS.map((j) => `'${j}'`).join(' '), TLIST_TYPE: 'JD', TIME_TYPE: 'TDB',
    });
    out.validation[id] = rows.map((f) => ({ jdTdb: Number(f[0]), r: f.slice(2, 5).map(Number) }));
    console.log(`validation ${id}`);
  }

  for (const [site, s] of Object.entries(SITES)) {
    for (const [body, command] of Object.entries(OBSERVER_BODIES)) {
      const rows = await horizons({
        COMMAND: `'${command}'`, EPHEM_TYPE: 'OBSERVER', CENTER: "'coord@399'", COORD_TYPE: 'GEODETIC',
        SITE_COORD: `'${s.lon},${s.lat},${s.heightKm}'`, TLIST: OBSERVER_TIMES_JD_UT.map((j) => `'${j}'`).join(' '),
        TLIST_TYPE: 'JD', TIME_TYPE: 'UT', QUANTITIES: "'1,2,4,9,20'", CSV_FORMAT: 'YES', ANG_FORMAT: 'DEG',
        APPARENT: 'AIRLESS', EXTRA_PREC: 'YES', CAL_FORMAT: 'JD',
      });
      for (const f of rows) {
        const n = (i) => Number(f[i]);
        out.observer.push({
          site, body, jdUt: n(0),
          raJ2000: n(3), decJ2000: n(4), ra: n(5), dec: n(6), az: n(7), alt: n(8),
          mag: f[9] === 'n.a.' ? null : n(9), deltaAu: n(11),
        });
      }
      console.log(`observer ${site} ${body}`);
    }
  }

  // Rise/set/transit for one UT day per site, using the standard sea-level convention
  // (airless centre altitude −34′ − semi-diameter, no horizon dip). Horizons' own R_T_S
  // modes include dip, so events are found here by interpolating its 1-minute airless
  // elevations and local apparent hour angles instead.
  const H0 = { sun: -(34 + 16) / 60, moon: -(34 + 15.5) / 60, jupiter: -34 / 60 };
  for (const [site, s] of Object.entries(SITES)) {
    for (const [body, command] of Object.entries({ sun: '10', moon: '301', jupiter: '599' })) {
      const rows = await horizons({
        COMMAND: `'${command}'`, EPHEM_TYPE: 'OBSERVER', CENTER: "'coord@399'", COORD_TYPE: 'GEODETIC',
        SITE_COORD: `'${s.lon},${s.lat},${s.heightKm}'`, START_TIME: "'2026-10-24'", STOP_TIME: "'2026-10-25'",
        STEP_SIZE: "'1 m'", QUANTITIES: "'4,42'", CSV_FORMAT: 'YES', ANG_FORMAT: 'DEG', APPARENT: 'AIRLESS',
        CAL_FORMAT: 'JD', TIME_TYPE: 'UT',
      });
      const pts = rows.map((f) => ({ jd: Number(f[0]), alt: Number(f[4]), ha: Number(f[5]) }));
      const toUtc = (jd) => new Date((jd - 2440587.5) * 86400000).toISOString();
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const fa = a.alt - H0[body], fb = b.alt - H0[body];
        if (Math.sign(fa) !== Math.sign(fb)) {
          out.riseSet.push({ site, body, kind: fb > fa ? 'rise' : 'set', utc: toUtc(a.jd + (b.jd - a.jd) * (fa / (fa - fb))) });
        }
        // Hour angle in hours, wrapping ±12; transit where it passes 0 from negative.
        if (a.ha < 0 && b.ha >= 0 && b.ha - a.ha < 1) {
          out.riseSet.push({ site, body, kind: 'transit', utc: toUtc(a.jd + (b.jd - a.jd) * (-a.ha / (b.ha - a.ha))) });
        }
      }
      console.log(`rise/set ${site} ${body}`);
    }
  }
  writeFileSync(resolve(fixturesDir, 'horizons-observer.json'), JSON.stringify(out, null, 1) + '\n');
}

const which = process.argv[2];
if (!which || which === 'm1') await milestone1();
if (!which || which === 'm2') await milestone2();
console.log('done');
