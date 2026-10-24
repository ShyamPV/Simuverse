#!/usr/bin/env node
// Builds the deep-sky (non-galaxy) catalogue: star clusters, nebulae, planetary
// nebulae and supernova remnants from OpenNGC (M. Verga, CC BY-SA 4.0), with
// distances from:
//   Harris (1996, 2010 ed., VizieR VII/202)        globular clusters
//   Cantat-Gaudin+ (2020, J/A+A/640/A1)            open clusters (Gaia DR2)
//   Chornay & Walton (2021, J/A+A/656/A110)          planetary nebulae (Gaia EDR3 central stars)
//   OpenNGC parallaxes (Gaia) where present
//   a small curated table for well-known nebulae (sources inline)
// Objects without a distance are kept for Sky view (direction only).
//
// Output: apps/web/public/data/deepsky.json

import { resolve, writeFileSync } from './lib.mjs';
import { dataOut, dmsToDeg, download, hmsToDeg, num, readFileSync, vizier } from './lib.mjs';

const KEEP = new Set(['OCl', 'GCl', 'Cl+N', 'PN', 'HII', 'EmN', 'Neb', 'RfN', 'SNR', 'DrkN', '*Ass', 'Other']);

/**
 * Distances (pc) for nebulae not covered by the cluster catalogues. Values are
 * literature consensus; `approx` marks objects whose published distances
 * disagree by more than ~20%.
 */
const CURATED = {
  NGC1976: [414, 'Menten et al. 2007 (VLBA parallax)'], // Orion Nebula, M42
  NGC1982: [414, 'Orion Nebula complex'], // M43
  NGC2068: [400, 'Orion B cloud'], // M78
  IC0434: [400, 'Orion B cloud'],
  B033: [400, 'Orion B cloud'], // Horsehead
  NGC2024: [400, 'Orion B cloud'], // Flame Nebula
  NGC1952: [2000, 'Trimble 1973'], // Crab Nebula, M1
  NGC6523: [1250, 'Gaia-era estimates, approx.', true], // Lagoon, M8
  NGC6514: [1600, 'Literature range 1.2–2.7 kpc, approx.', true], // Trifid, M20
  NGC6618: [1980, 'Xu et al. 2011 (maser parallax)'], // Omega, M17
  NGC6853: [385, 'Gaia parallax of central star'], // Dumbbell, M27
  NGC6720: [790, 'Gaia parallax of central star'], // Ring, M57
  NGC0650: [780, 'approx.', true], // Little Dumbbell, M76
  NGC3587: [610, 'approx.', true], // Owl, M97
  NGC7293: [200, 'Gaia parallax of central star'], // Helix
  NGC6543: [1000, 'approx.', true], // Cat's Eye
  NGC3132: [750, 'Gaia parallax of central star'], // Southern Ring
  NGC3372: [2300, 'Smith 2006'], // Carina Nebula
  NGC2237: [1500, 'Rosette complex, approx.', true],
  NGC7000: [795, 'Kuhn et al. 2020 (Gaia)'], // North America
  IC5070: [795, 'Kuhn et al. 2020 (Gaia)'], // Pelican
  NGC6960: [735, 'Fesen et al. 2018'], // Veil (western)
  NGC6992: [735, 'Fesen et al. 2018'], // Veil (eastern)
  NGC6995: [735, 'Fesen et al. 2018'],
  NGC2070: [49590, 'LMC distance, Pietrzyński et al. 2019'], // Tarantula
  IC1396: [925, 'Contreras et al. 2002, approx.', true],
  IC1805: [2000, 'Perseus arm, approx.', true], // Heart
  IC1848: [2000, 'Perseus arm, approx.', true], // Soul
  NGC1499: [450, 'approx.', true], // California
  NGC6888: [1500, 'approx.', true], // Crescent
  IC0405: [450, 'approx.', true], // Flaming Star
  NGC1981: [390, 'Orion Nebula complex'], // Upper Sword
  IC4604: [137, 'Ortiz-León et al. 2017 (VLBA, ρ Oph)'], // ρ Ophiuchi cloud
  IC4703: [1700, 'NGC 6611 cluster (Gaia)', true], // Eagle Nebula
  NGC2238: [1550, 'NGC 2244 cluster (Gaia)'], // Rosette Nebula
  NGC2246: [1550, 'NGC 2244 cluster (Gaia)'], // Rosette B
  NGC7023: [357, 'HD 200775 (Gaia)'], // Iris Nebula
  NGC7635: [2700, 'BD+60 2522 (Gaia)', true], // Bubble Nebula
  NGC2261: [800, 'R Monocerotis', true], // Hubble's Variable Nebula
  NGC1555: [145, 'Taurus clouds (T Tauri)'], // Hind's Variable Nebula
  IC0443: [1500, 'Welsh & Sallmen 2003', true], // Jellyfish Nebula
  IC0349: [136, 'Pleiades cluster (Gaia)'], // Barnard's Merope Nebula
  NGC1432: [136, 'Pleiades cluster (Gaia)'], // Maia Nebula
  NGC1435: [136, 'Pleiades cluster (Gaia)'], // Merope Nebula
  NGC1909: [290, 'Near Rigel', true], // Witch Head Nebula
  NGC2174: [2100, 'Gem OB1 association', true], // Monkey Head Nebula
  NGC2736: [290, 'Vela SNR (Dodson et al. 2003)', true], // Pencil Nebula
  NGC6188: [1300, 'Ara OB1 association', true], // Rim Nebula
  IC2944: [1800, 'Cen OB2 association', true], // λ Cen Nebula
  IC2220: [380, 'HD 65750', true], // Toby Jug Nebula
  C009: [725, 'Cep OB3 association', true], // Cave Nebula
};

async function main() {
  const ngcPath = await download('https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv', 'openngc.csv');
  const addPath = await download('https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv', 'openngc-addendum.csv');
  const lines = [...readFileSync(ngcPath, 'utf8').split('\n'), ...readFileSync(addPath, 'utf8').split('\n').slice(1)];
  const header = lines[0].split(';');
  const col = (n) => header.indexOf(n);

  const harris = await vizier('VII/202/catalog', 'harris2010.tsv', ['ID', 'Name', 'Rsun']);
  const cg = await vizier('J/A+A/640/A1/table1', 'cantatgaudin2020-plx.tsv', ['Cluster', 'plx', 'DistPc', 'r50', 'nbstars07']);
  const norm = (s) => s.toUpperCase().replace(/[\s_]+/g, '').replace(/^(NGC|IC|MEL|COLLINDER|CR)0*(\d+)/, '$1$2');
  const harrisBy = new Map(harris.map((r) => [norm(r.ID), num(r.Rsun) * 1000]));
  // DistPc in this table is photometric (neural-network distance modulus); for clusters with a
  // well-measured parallax, the parallax (with the Gaia DR2 zero-point of −0.029 mas) is better.
  const cgDistance = (r) => (num(r.plx) > 0.5 ? 1000 / (num(r.plx) + 0.029) : num(r.DistPc));
  const cgBy = new Map(cg.map((r) => [norm(r.Cluster.replace(/^Melotte/, 'MEL')), { d: cgDistance(r), n: num(r.nbstars07) }]));

  // Planetary nebula central stars: combined distance, high-reliability identifications only.
  const pnRows = await vizier('J/A+A/656/A110', 'chornay2021-pncs.tsv', ['Name', 'pnRAdeg', 'pnDEdeg', 'Rel', 'rcomb']);
  const pns = pnRows
    .map((r) => ({ ra: num(r.pnRAdeg), dec: num(r.pnDEdeg), rel: num(r.Rel), d: num(r.rcomb) }))
    .filter((r) => Number.isFinite(r.d) && r.rel >= 0.8 && r.d > 0);
  const pnDistance = (raDeg, decDeg) => {
    let best = null, bestSep = 30 / 3600;
    for (const p of pns) {
      const dra = (p.ra - raDeg) * Math.cos((decDeg * Math.PI) / 180), ddec = p.dec - decDeg;
      if (Math.abs(ddec) > bestSep) continue;
      const sep = Math.hypot(dra, ddec);
      if (sep < bestSep) { bestSep = sep; best = p.d; }
    }
    return best;
  };

  const out = [];
  const counts = {};
  for (const line of lines.slice(1)) {
    const f = line.split(';');
    const type = f[col('Type')];
    if (!KEEP.has(type)) continue;
    const id = f[col('Name')];
    const messier = f[col('M')] ? `M${Number(f[col('M')])}` : undefined;
    const common = (f[col('Common names')] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    // Unnamed asterisms and "Other" entries are only interesting if they're famous.
    if ((type === '*Ass' || type === 'Other') && !messier && common.length === 0) continue;

    const key = norm(id);
    let distPc = null, distSrc = null, approx = false;
    if (type === 'GCl' && harrisBy.has(key)) {
      distPc = harrisBy.get(key);
      distSrc = 'Harris 2010';
    } else if (cgBy.has(key) && Number.isFinite(cgBy.get(key).d)) {
      distPc = cgBy.get(key).d;
      distSrc = 'Cantat-Gaudin et al. 2020 (Gaia)';
    } else if (CURATED[id]) {
      [distPc, distSrc, approx = false] = CURATED[id];
    } else if (type === 'PN' && pnDistance(hmsToDeg(f[col('RA')]), dmsToDeg(f[col('Dec')])) !== null) {
      distPc = pnDistance(hmsToDeg(f[col('RA')]), dmsToDeg(f[col('Dec')]));
      distSrc = 'Chornay & Walton 2021 (Gaia EDR3 central star)';
    } else {
      const pax = num(f[col('Pax')]);
      if (pax > 0.3 && /Cl|Ass/.test(type)) {
        distPc = 1000 / pax;
        distSrc = 'Gaia parallax (OpenNGC)';
      }
    }

    const display = id.replace(/^(NGC|IC)0*(\d+)/, '$1 $2').replace(/^Mel0*(\d+)/, 'Melotte $1').replace(/^B0*(\d+)/, 'Barnard $1');
    const names = [...new Set([messier, ...common, display].filter(Boolean))];
    out.push({
      id: display,
      name: common[0] ? (messier ? `${common[0]}` : common[0]) : messier ?? display,
      aliases: names.filter((n) => n !== (common[0] ?? messier ?? display)),
      type,
      ra: Math.round(hmsToDeg(f[col('RA')]) * 1e4) / 1e4,
      dec: Math.round(dmsToDeg(f[col('Dec')]) * 1e4) / 1e4,
      majAx: num(f[col('MajAx')]) || null,
      minAx: num(f[col('MinAx')]) || null,
      pa: Number.isFinite(num(f[col('PosAng')])) ? num(f[col('PosAng')]) : null,
      mag: Number.isFinite(num(f[col('V-Mag')])) ? num(f[col('V-Mag')]) : Number.isFinite(num(f[col('B-Mag')])) ? num(f[col('B-Mag')]) : null,
      con: f[col('Const')],
      distPc: distPc === null ? null : Math.round(distPc),
      distSrc,
      approx: approx || undefined,
      messier: messier ? Number(messier.slice(1)) : undefined,
    });
    counts[type] = (counts[type] ?? 0) + 1;
  }
  out.sort((a, b) => (a.messier ?? 999) - (b.messier ?? 999) || (a.mag ?? 99) - (b.mag ?? 99));
  writeFileSync(resolve(dataOut, 'deepsky.json'), JSON.stringify(out));
  const withDist = out.filter((o) => o.distPc !== null).length;
  console.log(`Wrote ${out.length} deep-sky objects (${withDist} with distances):`, counts);
  for (const m of ['M42', 'M45', 'M13', 'M1', 'M57', 'M44', 'M27', 'M97', 'M76', 'NGC 6543', 'NGC 7293', 'NGC 3132']) {
    const o = out.find((x) => x.aliases.includes(m) || x.name === m);
    console.log(`  ${m}: ${o?.name} (${o?.type}) ${o?.distPc ?? '—'} pc [${o?.distSrc ?? 'no distance'}]`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
