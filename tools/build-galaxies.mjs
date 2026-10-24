#!/usr/bin/env node
// Builds the galaxy catalogue from real survey data:
//   2MRS (Huchra+ 2012, J/ApJS/199/26)        43.5k galaxies, whole sky, K < 11.75, redshifts
//   Cosmicflows-4 (Tully+ 2023, J/ApJ/944/94)  redshift-independent distances
//   McConnachie (2012, J/AJ/144/4)              Local Group members and distances
//   OpenNGC (M. Verga, CC BY-SA 4.0)            names, Messier numbers, optical sizes, position angles
//
// Distance priority: Local Group (McConnachie) > Cosmicflows-4 > redshift (cz / H0).
// Unknown position angles are seeded deterministically and flagged.
//
// Output (apps/web/public/data):
//   galaxies.bin  'SVGX', uint32 count, uint32 floatsPerRecord, uint32 reserved, then float32 records:
//                 x, y, z (Mpc, ICRS equatorial, Sun-centred), absMagV, radiusKpc, axisRatio,
//                 paDeg (−999 = unknown), tType, flags, czKmS, appMagV
//                 sorted by apparent magnitude (brightest first)
//   galaxy-names.json  [{ i, name, aliases[], hubble }]

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEG, SkyIndex, dataOut, dmsToDeg, download, hash01, hmsToDeg, num, readFileSync, vizier } from './lib.mjs';

const H0 = 74.6; // km/s/Mpc, the Cosmicflows-4 calibration
/** Largest plausible optical radius outside the Local Group (giant cD ellipticals reach ~100 kpc halos). */
const MAX_RADIUS_KPC = 60;
const FLOATS = 11;
export const FLAG = { REDSHIFT: 1, CF4: 2, LOCAL_GROUP: 4, PA_UNKNOWN: 8, SIZE_FROM_K: 16 };

/** Hubble-type string → numerical T-type (de Vaucouleurs). */
export function hubbleToT(h) {
  if (!h) return NaN;
  const s = h.replace(/[()?:]/g, '').trim();
  if (/^(dSph|dE|dS0|E)/.test(s)) return s.startsWith('E-S0') ? -3 : -5;
  if (/^S0-a/.test(s)) return 0;
  if (/^(S0|SB0|SAB0|SA0)/.test(s)) return -2;
  if (/^(I|dIrr|Im|IB|IAB|SBm|SABm|Sm)/.test(s)) return /m$/.test(s) && s.startsWith('S') ? 9 : 10;
  const m = /^S(?:A|B|AB)?(a|ab|b|bc|c|cd|d|dm|m)/.exec(s.replace(/^\(?S\(B\)/, 'SB'));
  if (m) return { a: 1, ab: 2, b: 3, bc: 4, c: 5, cd: 6, d: 7, dm: 8, m: 9 }[m[1]];
  return NaN;
}

/** Typical V−K colour by T-type, for estimating optical brightness from 2MASS K. */
const vMinusK = (t) => (t <= 0 ? 3.3 : t >= 9 ? 2.3 : 3.2 - 0.08 * t);

async function main() {
  const twoMrs = await vizier('J/ApJS/199/26/table3', '2mrs-v2.tsv',
    ['ID', 'RAJ2000', 'DEJ2000', 'Ktmag', 'Kcmag', 'E(B-V)', 'Rext', 'b/a', 'type', 'cz']);
  const cf4 = await vizier('J/ApJ/944/94/table2', 'cf4.tsv', ['PGC', 'RAJ2000', 'DEJ2000', 'DM', 'e_DM', 'Vcmb']);
  const lg = await vizier('J/AJ/144/4/catalog', 'mcconnachie2012.tsv',
    ['Name', 'MType', 'RAJ2000', 'DEJ2000', 'D', 'Vmag', 'R1', 'PA', 'Ell']);
  console.log(`2MRS ${twoMrs.length}, CF4 ${cf4.length}, McConnachie ${lg.length}`);

  // OpenNGC galaxies keyed by 2MASX id, for names/sizes/PA.
  const ngcPath = await download('https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv', 'openngc.csv');
  const addPath = await download('https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv', 'openngc-addendum.csv');
  const ngcRows = [...readFileSync(ngcPath, 'utf8').split('\n'), ...readFileSync(addPath, 'utf8').split('\n').slice(1)];
  const header = ngcRows[0].split(';');
  const col = (name) => header.indexOf(name);
  const byTwoMass = new Map();
  const ngcGalaxies = [];
  for (const line of ngcRows.slice(1)) {
    const f = line.split(';');
    if (!/^(G|GPair|GTrpl|GGroup)$/.test(f[col('Type')] ?? '')) continue;
    const g = {
      name: f[col('Name')], ra: hmsToDeg(f[col('RA')]), dec: dmsToDeg(f[col('Dec')]),
      majAx: num(f[col('MajAx')]), minAx: num(f[col('MinAx')]), pa: num(f[col('PosAng')]),
      hubble: f[col('Hubble')], vmag: num(f[col('V-Mag')]), bmag: num(f[col('B-Mag')]),
      messier: f[col('M')], common: f[col('Common names')], ids: f[col('Identifiers')] ?? '',
    };
    ngcGalaxies.push(g);
    const m = /2MASX ?J ?(\d{8}[+-]\d{7})/.exec(g.ids);
    if (m) byTwoMass.set(m[1], g);
  }
  const ngcIndex = new SkyIndex(ngcGalaxies, (g) => g.ra, (g) => g.dec);

  const cf4Index = new SkyIndex(cf4.filter((r) => r.DM !== ''), (r) => num(r.RAJ2000), (r) => num(r.DEJ2000));

  // Local Group members (skip the Milky Way itself and its disk substructures).
  const lgMembers = lg
    .filter((r) => r.D !== '' && r.Name !== 'The Galaxy' && r.Name !== 'Canis Major')
    .map((r) => ({
      name: r.Name.replace(/\s+/g, ' ').trim(), ra: hmsToDeg(r.RAJ2000), dec: dmsToDeg(r.DEJ2000),
      distMpc: num(r.D) / 1000, vmag: num(r.Vmag), r1: num(r.R1), pa: num(r.PA), ell: num(r.Ell), mtype: r.MType,
      matched: false,
    }));
  const lgIndex = new SkyIndex(lgMembers, (g) => g.ra, (g) => g.dec);

  const out = [];
  const names = [];
  const pushNames = (i, ngc, lgName) => {
    if (!ngc && !lgName) return;
    const aliases = [];
    let name;
    const common = ngc?.common?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    const catalogueName = ngc ? ngc.name.replace(/^(NGC|IC)0*(\d+)/, '$1 $2') : undefined;
    const messier = ngc?.messier ? `M${Number(ngc.messier)}` : undefined;
    name = common[0] ?? (messier ? (lgName ?? messier) : lgName ?? catalogueName);
    for (const a of [messier, catalogueName, lgName, ...common.slice(1)]) if (a && a !== name && !aliases.includes(a)) aliases.push(a);
    names.push({ i, name, aliases, hubble: ngc?.hubble || undefined });
  };

  // Calibrate optical (D25) radius against the 2MASS K-band extent using galaxies that have both.
  const ratios = [];
  for (const r of twoMrs) {
    const ngc = byTwoMass.get(r.ID);
    const k = 10 ** num(r.Rext) / 60;
    if (Number.isFinite(ngc?.majAx) && Number.isFinite(k) && k > 0) ratios.push(ngc.majAx / 2 / k);
  }
  ratios.sort((a, b) => a - b);
  const kToOptical = ratios[ratios.length >> 1] ?? 1.5;
  console.log(`Optical/K radius ratio: median ${kToOptical.toFixed(2)} from ${ratios.length} galaxies`);

  let noDistance = 0;
  for (const r of twoMrs) {
    const ra = num(r.RAJ2000), dec = num(r.DEJ2000);
    // Total K magnitude, or the isophotal one where the total is missing (~2% of 2MRS).
    const kt = Number.isFinite(num(r.Ktmag)) ? num(r.Ktmag) : num(r.Kcmag), ebv = num(r.E_B_V ?? r['E(B-V)']) || 0;
    const cz = num(r.cz);
    let flags = 0;
    const ngc = byTwoMass.get(r.ID);
    // Local Group match: within the member's half-light radius (or 3′).
    const lgm = lgIndex.nearest(ra, dec, 0.5);
    const lgMatch = lgm && lgm.distMpc < 3 && cz < 600 && separationOk(lgm, ra, dec) ? lgm : undefined;
    let distMpc;
    if (lgMatch) {
      distMpc = lgMatch.distMpc;
      lgMatch.matched = true;
      flags |= FLAG.LOCAL_GROUP;
    } else {
      const c = cf4Index.nearest(ra, dec, 12 / 3600);
      if (c) {
        distMpc = 10 ** ((num(c.DM) - 25) / 5);
        flags |= FLAG.CF4;
      } else if (Number.isFinite(cz)) {
        distMpc = Math.max(cz, 300) / H0;
        flags |= FLAG.REDSHIFT;
      } else {
        // No redshift and no independent distance: it can't be placed in 3D.
        noDistance++;
        continue;
      }
    }
    const t = Number.isFinite(hubbleToT(ngc?.hubble)) ? hubbleToT(ngc.hubble) : parseTwoMrsType(r.type);
    const kCorr = kt - 0.367 * ebv;
    const appV = Number.isFinite(ngc?.vmag) ? ngc.vmag : kCorr + vMinusK(Number.isFinite(t) ? t : 3);
    const absV = appV - 5 * Math.log10(distMpc * 1e5);
    let radiusArcmin, axisRatio = num(r['b/a']);
    if (Number.isFinite(ngc?.majAx)) {
      radiusArcmin = ngc.majAx / 2;
      if (Number.isFinite(ngc.minAx) && ngc.minAx > 0) axisRatio = ngc.minAx / ngc.majAx;
    } else {
      // The K-band extent underestimates the optical disc; scale by the calibrated ratio.
      radiusArcmin = (10 ** num(r.Rext) / 60) * kToOptical;
      flags |= FLAG.SIZE_FROM_K;
    }
    let pa = ngc?.pa;
    if (!Number.isFinite(pa)) {
      pa = -999;
      flags |= FLAG.PA_UNKNOWN;
    }
    let radiusKpc = radiusArcmin * (DEG / 60) * distMpc * 1000;
    // No usable extent, or an implausible one (the K-band scaling inflates faint, distant galaxies):
    // fall back to the size–luminosity relation, R ≈ 15 kpc at L*, R ∝ L^0.4.
    if (!Number.isFinite(radiusKpc) || radiusKpc > MAX_RADIUS_KPC) {
      radiusKpc = Math.min(15 * 10 ** (-0.4 * 0.4 * (absV + 21)), MAX_RADIUS_KPC);
      flags |= FLAG.SIZE_FROM_K;
    }
    const i = out.length;
    out.push({ ra, dec, distMpc, absV, appV, radiusKpc, axisRatio: Number.isFinite(axisRatio) ? axisRatio : 0.7, pa, t: Number.isFinite(t) ? t : 3, flags, cz });
    pushNames(i, ngc, lgMatch?.name);
  }

  // Local Group galaxies not in 2MRS (LMC, SMC and the dwarfs).
  for (const g of lgMembers) {
    if (g.matched) continue;
    // R1 is missing for some members (e.g. the Magellanic Clouds); Math.max(NaN, …) would be NaN.
    const ngc = ngcIndex.nearest(g.ra, g.dec, Number.isFinite(g.r1) ? Math.min(Math.max(g.r1 / 60, 0.05), 1) : 0.5);
    const t = hubbleToT(g.mtype) || hubbleToT(ngc?.hubble);
    const appV = Number.isFinite(g.vmag) ? g.vmag : 15;
    const axisRatio = Number.isFinite(g.ell) ? 1 - g.ell : 0.8;
    const radiusArcmin = Number.isFinite(ngc?.majAx) ? ngc.majAx / 2 : Number.isFinite(g.r1) ? g.r1 * 2.5 : 1;
    const i = out.length;
    let flags = FLAG.LOCAL_GROUP;
    const pa = Number.isFinite(g.pa) ? g.pa : Number.isFinite(ngc?.pa) ? ngc.pa : -999;
    if (pa === -999) flags |= FLAG.PA_UNKNOWN;
    out.push({
      ra: g.ra, dec: g.dec, distMpc: g.distMpc, appV, absV: appV - 5 * Math.log10(g.distMpc * 1e5),
      radiusKpc: radiusArcmin * (DEG / 60) * g.distMpc * 1000, axisRatio, pa, t: Number.isFinite(t) ? t : 10, flags, cz: NaN,
    });
    pushNames(i, ngc, g.name);
  }

  // Sort brightest first, remapping name indices.
  const order = out.map((_, i) => i).sort((a, b) => out[a].appV - out[b].appV);
  const newIndex = new Map(order.map((old, n) => [old, n]));
  const buf = Buffer.alloc(16 + order.length * FLOATS * 4);
  buf.write('SVGX', 0, 'ascii');
  buf.writeUInt32LE(order.length, 4);
  buf.writeUInt32LE(FLOATS, 8);
  const f32 = new Float32Array(buf.buffer, buf.byteOffset + 16, order.length * FLOATS);
  order.forEach((old, n) => {
    const g = out[old];
    const c = Math.cos(g.dec * DEG);
    f32.set([
      g.distMpc * c * Math.cos(g.ra * DEG), g.distMpc * c * Math.sin(g.ra * DEG), g.distMpc * Math.sin(g.dec * DEG),
      g.absV, g.radiusKpc, g.axisRatio, g.pa, g.t, g.flags, g.cz, g.appV,
    ], n * FLOATS);
  });
  writeFileSync(resolve(dataOut, 'galaxies.bin'), buf);
  const remapped = names.map((n) => ({ ...n, i: newIndex.get(n.i) })).sort((a, b) => a.i - b.i);
  writeFileSync(resolve(dataOut, 'galaxy-names.json'), JSON.stringify(remapped));

  const count = (bit) => out.filter((g) => g.flags & bit).length;
  console.log(
    `Wrote ${order.length} galaxies (${(buf.length / 1e6).toFixed(2)} MB): ${count(FLAG.LOCAL_GROUP)} Local Group, ` +
      `${count(FLAG.CF4)} CF4 distances, ${count(FLAG.REDSHIFT)} redshift distances, ${remapped.length} named; ` +
      `skipped ${noDistance} without any distance`,
  );
  for (const want of ['Andromeda Galaxy', 'Triangulum Galaxy', 'Large Magellanic Cloud', 'Small Magellanic Cloud', 'Whirlpool Galaxy', 'Sombrero Galaxy', 'Centaurus A', 'M87', "Bode's Galaxy"]) {
    const n = remapped.find((x) => x.name === want || x.aliases.includes(want));
    if (!n) {
      console.log(`  ${want}: MISSING`);
      continue;
    }
    const k = order[n.i];
    console.log(`  ${want}: ${out[k].distMpc.toFixed(3)} Mpc, V=${out[k].appV.toFixed(2)}, r=${out[k].radiusKpc.toFixed(1)} kpc, PA=${out[k].pa}, T=${out[k].t}`);
  }
}

/**
 * 2MRS morphology code (ZCAT style, e.g. " 3A2s", "-5"): leading signed integer
 * is the T-type; 90+ are "unknown/peculiar" codes and are treated as unknown.
 */
function parseTwoMrsType(code) {
  const m = /^\s*(-?\d{1,2})/.exec(code ?? '');
  const t = m ? Number(m[1]) : NaN;
  return t >= -6 && t <= 11 ? t : NaN;
}

/**
 * A 2MRS galaxy is the same object as a Local Group member only if it sits at
 * the member's centre: huge members (LMC, R1 ≈ 10°) contain unrelated entries.
 */
function separationOk(g, ra, dec) {
  const reach = Math.min(0.2, Math.max(((g.r1 || 3) / 60) * 0.3, 2 / 60));
  const dRa = (ra - g.ra) * Math.cos(dec * DEG), dDec = dec - g.dec;
  return Math.hypot(dRa, dDec) < reach;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
