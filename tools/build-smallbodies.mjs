#!/usr/bin/env node
// Builds smallbodies.json: osculating orbits, physical data and discovery
// circumstances for well-known asteroids, dwarf planets and comets from the
// JPL Small-Body Database API (public domain).
//
// Elements are heliocentric ecliptic J2000; the app propagates them as
// two-body (Kepler) orbits, so positions far from the epoch are approximate.
//
// Usage: node tools/build-smallbodies.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dataOut, root } from './lib.mjs';

const cacheDir = resolve(root, '.cache/sbdb');

/** [designation for SBDB, display name, kind]. */
const BODIES = [
  ['1', 'Ceres', 'dwarf-planet'],
  ['136199', 'Eris', 'dwarf-planet'],
  ['136108', 'Haumea', 'dwarf-planet'],
  ['136472', 'Makemake', 'dwarf-planet'],
  ['90377', 'Sedna', 'tno'],
  ['50000', 'Quaoar', 'tno'],
  ['486958', 'Arrokoth', 'tno'],
  ['4', 'Vesta', 'asteroid'],
  ['2', 'Pallas', 'asteroid'],
  ['10', 'Hygiea', 'asteroid'],
  ['16', 'Psyche', 'asteroid'],
  ['433', 'Eros', 'asteroid'],
  ['243', 'Ida', 'asteroid'],
  ['951', 'Gaspra', 'asteroid'],
  ['21', 'Lutetia', 'asteroid'],
  ['25143', 'Itokawa', 'asteroid'],
  ['101955', 'Bennu', 'asteroid'],
  ['162173', 'Ryugu', 'asteroid'],
  ['99942', 'Apophis', 'asteroid'],
  ['65803', 'Didymos', 'asteroid'],
  ['3200', 'Phaethon', 'asteroid'],
  ['3753', 'Cruithne', 'asteroid'],
  ['469219', 'Kamoʻoalewa', 'asteroid'],
  ['1P', 'Halley’s Comet', 'comet'],
  ['2P', 'Comet Encke', 'comet'],
  ['9P', 'Tempel 1', 'comet'],
  ['19P', 'Borrelly', 'comet'],
  ['67P', 'Churyumov–Gerasimenko', 'comet'],
  ['81P', 'Wild 2', 'comet'],
  ['103P', 'Hartley 2', 'comet'],
  ['109P', 'Swift–Tuttle', 'comet'],
  ['55P', 'Tempel–Tuttle', 'comet'],
  ['12P', 'Pons–Brooks', 'comet'],
  ['C/1995 O1', 'Hale–Bopp', 'comet'],
  ['C/2020 F3', 'NEOWISE', 'comet'],
  ['C/2023 A3', 'Tsuchinshan–ATLAS', 'comet'],
  ['2I', '2I/Borisov', 'interstellar'],
  ['1I', '1I/ʻOumuamua', 'interstellar'],
];

/** Literature values where SBDB has none (diameters in km; discovery date and discoverer). */
const SUPPLEMENT = {
  136199: { diameterKm: 2326, source: 'Sicardy et al. 2011 (occultation)' },
  136108: { diameterKm: 1632, source: 'Ortiz et al. 2017 (occultation; volume-equivalent, elongated)' },
  136472: { diameterKm: 1430, source: 'Ortiz et al. 2012 (occultation)' },
  90377: { diameterKm: 995, source: 'Pál et al. 2012 (Herschel)' },
  50000: { diameterKm: 1110, source: 'Braga-Ribas et al. 2013 (occultation)' },
  486958: { diameterKm: 36, source: 'New Horizons (longest dimension)' },
  'C/1995 O1': { discovered: '1995-Jul-23', discoverer: 'Hale, Alan; Bopp, Thomas' },
  'C/2020 F3': { diameterKm: 5, discovered: '2020-Mar-27', discoverer: 'NEOWISE (space telescope)', source: 'NEOWISE team' },
  'C/2023 A3': { discovered: '2023-Jan-09', discoverer: 'Purple Mountain Observatory (Tsuchinshan); ATLAS' },
  '2I': { discovered: '2019-Aug-30', discoverer: 'Borisov, Gennady' },
  '1I': { discovered: '2017-Oct-19', discoverer: 'Weryk, Robert (Pan-STARRS)' },
};

async function sbdb(des) {
  mkdirSync(cacheDir, { recursive: true });
  const file = resolve(cacheDir, `${des.replace(/[^\w]+/g, '_')}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const params = new URLSearchParams({ sstr: des, 'phys-par': '1', discovery: '1', 'full-prec': '1' });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`https://ssd-api.jpl.nasa.gov/sbdb.api?${params}`);
      const json = await res.json();
      if (!res.ok || !json.orbit) throw new Error(json.message ?? `HTTP ${res.status}`);
      writeFileSync(file, JSON.stringify(json));
      return json;
    } catch (err) {
      if (attempt >= 3) throw new Error(`${des}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

const out = [];
for (const [des, name, kind] of BODIES) {
  const j = await sbdb(des);
  const el = Object.fromEntries(j.orbit.elements.map((e) => [e.name, num(e.value)]));
  const phys = Object.fromEntries((j.phys_par ?? []).map((p) => [p.name, num(p.value)]));
  const extent = (j.phys_par ?? []).find((p) => p.name === 'extent')?.value ?? null;
  const d = j.discovery ?? {};
  const sup = SUPPLEMENT[des] ?? {};
  if (phys.diameter === undefined && sup.diameterKm) phys.diameter = sup.diameterKm;
  if (!d.date && sup.discovered) Object.assign(d, { date: sup.discovered, who: sup.discoverer });
  out.push({
    des, name, kind, fullname: j.object.fullname, orbitClass: j.object.orbit_class?.name ?? null,
    neo: !!j.object.neo, pha: !!j.object.pha,
    epochJd: num(j.orbit.epoch),
    // Elements: e, q (AU), i, Ω, ω (deg), tp (JD TDB perihelion time); a (AU) and M (deg) for closed orbits.
    e: el.e, q: el.q, a: el.a, i: el.i, node: el.om, peri: el.w, ma: el.ma, tp: el.tp, periodDays: el.per,
    diameterKm: phys.diameter ?? null, extentKm: extent, albedo: phys.albedo ?? null, rotationH: phys.rot_per ?? null,
    gm: phys.GM ?? null, H: phys.H ?? null, G: phys.G ?? null,
    // Comet magnitude parameters (total): m = M1 + 5 log Δ + K1 log r.
    M1: phys.M1 ?? null, K1: phys.K1 ?? null,
    discovered: d.date ?? null, discoverer: d.who ?? null, discoverySite: d.location || d.site || null,
    diameterSource: sup.diameterKm && sup.diameterKm === phys.diameter ? sup.source : undefined,
  });
  console.log(`  ${name.padEnd(24)} ${kind.padEnd(13)} e=${el.e?.toFixed(3)} q=${el.q?.toFixed(3)} D=${phys.diameter ?? '—'} km  disc ${d.date ?? '—'} ${d.who ?? ''}`);
}
writeFileSync(resolve(dataOut, 'smallbodies.json'), JSON.stringify({ source: 'JPL Small-Body Database', retrieved: new Date().toISOString().slice(0, 10), bodies: out }));
console.log(`Wrote ${out.length} small bodies.`);
