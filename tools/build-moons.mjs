#!/usr/bin/env node
// Fits mean orbital elements for the major moons from JPL Horizons state
// vectors (moon relative to its planet, ICRF), in each planet's equatorial
// frame where the J2-driven precession of node and apse is close to linear.
//
//  1. Samples each moon every ~12 days over 1950–2050, plus a dense window
//     that pins down the mean motion for unwrapping the mean longitude.
//  2. Converts every sample to osculating elements and least-squares fits
//     λ = λ0 + n·t + ṅ·t² + Σ librations, ϖ = ϖ0 + ϖ̇·t, Ω = Ω0 + Ω̇·t, with
//     mean a, e, i. Librations are long-period sinusoids found by scanning the
//     λ residuals (e.g. Mimas's ±44°, 70-year Mimas–Tethys resonance).
//     Retrograde orbits (Uranus's moons relative to its IAU pole, Triton) are
//     fitted about the opposite pole, so that every orbit is prograde.
//  3. Writes packages/astro/src/moonElements.ts and a test fixture of
//     Horizons positions, and prints the fit residuals.
//
// Usage: node tools/build-moons.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './lib.mjs';

const cacheDir = resolve(root, '.cache/horizons-moons');
const DEG = Math.PI / 180;
const J2000 = 2451545.0;
const START = 2433282.5; // 1950-01-01
const STOP = 2469807.5; // 2050-01-01
const SPARSE_INTERVALS = 3000;

// Planet GM (km³/s², planet only) and mean IAU pole (deg, J2000).
const PLANETS = {
  mars: { horizons: '499', gm: 42828.37, pole: [317.269202, 54.432516] },
  jupiter: { horizons: '599', gm: 126686531.9, pole: [268.056595, 64.495303] },
  saturn: { horizons: '699', gm: 37931206.23, pole: [40.589, 83.537] },
  uranus: { horizons: '799', gm: 5793951.3, pole: [257.311, -15.175] },
  neptune: { horizons: '899', gm: 6835099.5, pole: [299.36, 43.46] },
  pluto: { horizons: '999', gm: 869.6, pole: [132.993, -6.163] },
};

// Physical data: mean radius (km), GM (km³/s²), geometric albedo, colour.
const MOONS = [
  { id: 'phobos', name: 'Phobos', parent: 'mars', horizons: '401', radius: 11.08, gm: 7.087e-4, albedo: 0.071, color: '#8a7f74' },
  { id: 'deimos', name: 'Deimos', parent: 'mars', horizons: '402', radius: 6.2, gm: 9.62e-5, albedo: 0.068, color: '#9c8f80' },
  { id: 'io', name: 'Io', parent: 'jupiter', horizons: '501', radius: 1821.6, gm: 5959.92, albedo: 0.63, color: '#e3cf6a' },
  { id: 'europa', name: 'Europa', parent: 'jupiter', horizons: '502', radius: 1560.8, gm: 3202.71, albedo: 0.67, color: '#d6c8aa' },
  { id: 'ganymede', name: 'Ganymede', parent: 'jupiter', horizons: '503', radius: 2634.1, gm: 9887.83, albedo: 0.43, color: '#a99f92' },
  { id: 'callisto', name: 'Callisto', parent: 'jupiter', horizons: '504', radius: 2410.3, gm: 7179.29, albedo: 0.22, color: '#6f655a' },
  { id: 'mimas', name: 'Mimas', parent: 'saturn', horizons: '601', radius: 198.2, gm: 2.5026, albedo: 0.96, color: '#cbc8c2' },
  { id: 'enceladus', name: 'Enceladus', parent: 'saturn', horizons: '602', radius: 252.1, gm: 7.2096, albedo: 1.38, color: '#f2f5f8' },
  { id: 'tethys', name: 'Tethys', parent: 'saturn', horizons: '603', radius: 531.1, gm: 41.21, albedo: 1.23, color: '#dddad5' },
  { id: 'dione', name: 'Dione', parent: 'saturn', horizons: '604', radius: 561.4, gm: 73.116, albedo: 1.0, color: '#d0ccc5' },
  { id: 'rhea', name: 'Rhea', parent: 'saturn', horizons: '605', radius: 763.8, gm: 153.94, albedo: 0.95, color: '#c9c4bc' },
  { id: 'titan', name: 'Titan', parent: 'saturn', horizons: '606', radius: 2574.73, gm: 8978.14, albedo: 0.22, color: '#d8a24e' },
  { id: 'iapetus', name: 'Iapetus', parent: 'saturn', horizons: '608', radius: 734.5, gm: 120.52, albedo: 0.6, color: '#9b8a73' },
  { id: 'miranda', name: 'Miranda', parent: 'uranus', horizons: '705', radius: 235.8, gm: 4.4, albedo: 0.32, color: '#b9b8b4' },
  { id: 'ariel', name: 'Ariel', parent: 'uranus', horizons: '701', radius: 578.9, gm: 83.46, albedo: 0.39, color: '#c5c2bc' },
  { id: 'umbriel', name: 'Umbriel', parent: 'uranus', horizons: '702', radius: 584.7, gm: 85.09, albedo: 0.21, color: '#7e7b76' },
  { id: 'titania', name: 'Titania', parent: 'uranus', horizons: '703', radius: 788.4, gm: 226.94, albedo: 0.27, color: '#b6aea3' },
  { id: 'oberon', name: 'Oberon', parent: 'uranus', horizons: '704', radius: 761.4, gm: 205.32, albedo: 0.23, color: '#a69b8e' },
  { id: 'triton', name: 'Triton', parent: 'neptune', horizons: '801', radius: 1353.4, gm: 1427.6, albedo: 0.72, color: '#d9cac1' },
  { id: 'nereid', name: 'Nereid', parent: 'neptune', horizons: '802', radius: 170, gm: 2.06, albedo: 0.155, color: '#9b968f' },
  { id: 'charon', name: 'Charon', parent: 'pluto', horizons: '901', radius: 606, gm: 106.1, albedo: 0.38, color: '#a9a49e' },
];

// ---------------------------------------------------------------- math

const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; };
const mul = (a, b) => {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
};
const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const wrap = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** ICRF → frame whose z axis is the pole (ra, dec): x = ascending node of that equator on the ICRF equator. */
const icrfToEquator = ([ra, dec]) => mul(rotX((90 - dec) * DEG), rotZ((90 + ra) * DEG));

/** Osculating elements; angles in radians. λ = Ω + ω + M and ϖ = Ω + ω are defined for any inclination. */
function elements(r, v, mu) {
  const h = cross(r, v);
  const rn = norm(r);
  const i = Math.acos(h[2] / norm(h));
  const node = [-h[1], h[0], 0];
  const Omega = Math.atan2(node[1], node[0]);
  const ev = cross(v, h).map((c, k) => c / mu - r[k] / rn);
  const e = norm(ev);
  const a = 1 / (2 / rn - dot(v, v) / mu);
  // Argument of periapsis and true anomaly, measured in the orbit plane from the node.
  const nHat = norm(node) > 1e-12 ? node.map((c) => c / norm(node)) : [1, 0, 0];
  const hHat = h.map((c) => c / norm(h));
  const q = cross(hHat, nHat);
  const omega = Math.atan2(dot(ev, q), dot(ev, nHat));
  const u = Math.atan2(dot(r, q), dot(r, nHat)); // argument of latitude
  const nu = u - omega;
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  const M = E - e * Math.sin(E);
  return { a, e, i, Omega, varpi: Omega + omega, lambda: Omega + omega + M, rn };
}

/** Position from mean elements (planet equatorial frame), km. */
function position(el, t) {
  let lambda = el.lambda0 + el.n * t + el.ndot * t * t;
  for (const [s, c, f] of el.lib) lambda += s * Math.sin(f * t) + c * Math.cos(f * t);
  const varpi = el.varpi0 + el.varpiDot * t;
  const Omega = el.Omega0 + el.OmegaDot * t;
  const M = lambda - varpi, w = varpi - Omega;
  let E = M;
  for (let k = 0; k < 30; k++) E -= (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
  const xp = el.a * (Math.cos(E) - el.e), yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Omega), sO = Math.sin(Omega), ci = Math.cos(el.i), si = Math.sin(el.i);
  const x1 = cw * xp - sw * yp, y1 = sw * xp + cw * yp;
  return [cO * x1 - sO * ci * y1, sO * x1 + cO * ci * y1, si * y1];
}

/** Least squares y ≈ Σ c_k t^k for k < terms. */
function polyfit(t, y, terms) {
  return linfit(t, y, Array.from({ length: terms }, (_, k) => (x) => x ** k));
}

/** Linear least squares y ≈ Σ c_k basis_k(t). */
function linfit(t, y, basis) {
  const terms = basis.length;
  const A = Array.from({ length: terms }, () => new Array(terms).fill(0));
  const b = new Array(terms).fill(0);
  for (let s = 0; s < t.length; s++) {
    const p = basis.map((fn) => fn(t[s]));
    for (let j = 0; j < terms; j++) {
      b[j] += p[j] * y[s];
      for (let k = 0; k < terms; k++) A[j][k] += p[j] * p[k];
    }
  }
  for (let c = 0; c < terms; c++) {
    let piv = c;
    for (let r = c + 1; r < terms; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < terms; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < terms; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, k) => v / A[k][k]);
}

/**
 * Best single sinusoid (angular frequency f, rad/day) in residuals y(t), by a
 * log-spaced scan of periods; returns [sinAmp, cosAmp, f] and the new residuals.
 */
function bestSinusoid(t, y, minDays, maxDays) {
  let best = null;
  for (let P = minDays; P <= maxDays; P *= 1.004) {
    const f = (2 * Math.PI) / P;
    let ss = 0, sc = 0, cc = 0, ys = 0, yc = 0;
    for (let k = 0; k < t.length; k++) {
      const sn = Math.sin(f * t[k]), cs = Math.cos(f * t[k]);
      ss += sn * sn; sc += sn * cs; cc += cs * cs; ys += y[k] * sn; yc += y[k] * cs;
    }
    const det = ss * cc - sc * sc;
    const a = (ys * cc - yc * sc) / det, b = (yc * ss - ys * sc) / det;
    const gain = a * ys + b * yc; // reduction in the sum of squares
    if (!best || gain > best.gain) best = { gain, a, b, f };
  }
  const rest = t.map((x, k) => y[k] - best.a * Math.sin(best.f * x) - best.b * Math.cos(best.f * x));
  return { term: [best.a, best.b, best.f], rest };
}

/** Unwraps angles sampled at times t, predicting each step with rate `rate` (rad/day). */
function unwrap(t, ang, rate) {
  const out = [ang[0]];
  for (let k = 1; k < ang.length; k++) {
    const pred = out[k - 1] + rate * (t[k] - t[k - 1]);
    out.push(ang[k] + 2 * Math.PI * Math.round((pred - ang[k]) / (2 * Math.PI)));
  }
  return out;
}

// ---------------------------------------------------------------- Horizons

async function vectors(moon, planet, start, stop, step, tag) {
  mkdirSync(cacheDir, { recursive: true });
  const file = resolve(cacheDir, `${moon.id}-${tag}.txt`);
  let text;
  if (existsSync(file)) text = readFileSync(file, 'utf8');
  else {
    const params = new URLSearchParams({
      format: 'text', COMMAND: `'${moon.horizons}'`, EPHEM_TYPE: 'VECTORS', CENTER: `'500@${planet.horizons}'`,
      REF_PLANE: 'FRAME', REF_SYSTEM: 'ICRF', OUT_UNITS: 'KM-S', VEC_TABLE: '2', VEC_CORR: 'NONE',
      CSV_FORMAT: 'YES', VEC_LABELS: 'NO', OBJ_DATA: 'NO', TIME_TYPE: 'TDB',
      START_TIME: `'JD${start}'`, STOP_TIME: `'JD${stop}'`, STEP_SIZE: `'${step}'`,
    });
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`);
      text = await res.text();
      if (res.ok && text.includes('$$SOE')) break;
      if (attempt >= 3) throw new Error(`Horizons failed for ${moon.id}: ${text.slice(0, 400)}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    writeFileSync(file, text);
  }
  const body = text.slice(text.indexOf('$$SOE') + 5, text.indexOf('$$EOE'));
  return body.trim().split('\n').map((line) => {
    const f = line.split(',').map((s) => s.trim());
    return { jd: Number(f[0]), r: [Number(f[2]), Number(f[3]), Number(f[4])], v: [Number(f[5]), Number(f[6]), Number(f[7])] };
  });
}

// ---------------------------------------------------------------- fit

const out = [];
const fixtures = [];
for (const moon of MOONS) {
  const planet = PLANETS[moon.parent];
  const mu = planet.gm + moon.gm;
  // Fit about the pole that makes the orbit prograde (decided from the J2000 sample).
  let pole = planet.pole;
  {
    const [s0] = await vectors(moon, planet, J2000, J2000 + 1, '2', 'probe');
    const eq = icrfToEquator(pole);
    if (elements(apply(eq, s0.r), apply(eq, s0.v), mu).i > Math.PI / 2) pole = [(pole[0] + 180) % 360, -pole[1]];
  }
  const toEq = icrfToEquator(pole);
  const toPlanet = (s) => ({ ...s, r: apply(toEq, s.r), v: apply(toEq, s.v) });

  // Dense window → mean motion for unwrapping.
  const first = (await vectors(moon, planet, J2000, J2000 + 1, '2', 'probe')).map(toPlanet);
  const el0 = elements(first[0].r, first[0].v, mu);
  const periodDays = (2 * Math.PI * Math.sqrt(el0.a ** 3 / mu)) / 86400;
  const span = periodDays * 6;
  const dense = (await vectors(moon, planet, J2000, J2000 + span, '600', 'dense')).map(toPlanet);
  const dt = dense.map((s) => s.jd - J2000);
  const del = dense.map((s) => elements(s.r, s.v, mu));
  const n0 = polyfit(dt, unwrap(dt, del.map((e) => e.lambda), (2 * Math.PI) / periodDays), 2)[1];

  const sparse = (await vectors(moon, planet, START, STOP, String(SPARSE_INTERVALS), 'sparse')).map(toPlanet);
  const t = sparse.map((s) => s.jd - J2000);
  const els = sparse.map((s) => elements(s.r, s.v, mu));
  // Unwrap from J2000 outward in both directions so the prediction uses the precise n0 near the dense window.
  const k0 = t.findIndex((x) => x >= 0);
  const unwrapBoth = (ang, rate) => {
    const fwd = unwrap(t.slice(k0), ang.slice(k0), rate);
    const back = unwrap(t.slice(0, k0 + 1).reverse(), ang.slice(0, k0 + 1).reverse(), rate).reverse();
    const shift = fwd[0] - back[back.length - 1];
    return [...back.slice(0, -1).map((a) => a + shift), ...fwd];
  };
  const lambda = unwrapBoth(els.map((e) => e.lambda), n0);
  let [lambda0, n, ndot] = polyfit(t, lambda, 3);
  // Up to two long-period librations, kept only if each removes ≥ 30% of the remaining variance.
  const lib = [];
  let resid = t.map((x, k) => lambda[k] - lambda0 - n * x - ndot * x * x);
  for (let pass = 0; pass < 2; pass++) {
    const before = resid.reduce((acc, r) => acc + r * r, 0);
    const { term, rest } = bestSinusoid(t, resid, 200, 120 * 365.25);
    const after = rest.reduce((acc, r) => acc + r * r, 0);
    if (after > 0.7 * before) break;
    lib.push(term);
    resid = rest;
  }
  // Refine each libration frequency jointly with the polynomial (they trade off over a ~100-year window).
  const jointFit = (freqs) => {
    const basis = [(x) => 1, (x) => x, (x) => x * x];
    for (const fq of freqs) basis.push((x) => Math.sin(fq * x), (x) => Math.cos(fq * x));
    const c = linfit(t, lambda, basis);
    let ss = 0;
    for (let k = 0; k < t.length; k++) {
      const r = lambda[k] - basis.reduce((acc, fn, j) => acc + c[j] * fn(t[k]), 0);
      ss += r * r;
    }
    return { c, ss };
  };
  if (lib.length) {
    const freqs = lib.map((l) => l[2]);
    for (let iter = 0; iter < 3; iter++) {
      for (let j = 0; j < freqs.length; j++) {
        let best = { ss: Infinity, f: freqs[j] };
        for (let m = 0.5; m <= 2; m *= 1.002) {
          const trial = freqs.slice();
          trial[j] = freqs[j] * m;
          const { ss } = jointFit(trial);
          if (ss < best.ss) best = { ss, f: trial[j] };
        }
        freqs[j] = best.f;
      }
    }
    const { c } = jointFit(freqs);
    [lambda0, n, ndot] = c;
    lib.length = 0;
    freqs.forEach((fq, j) => lib.push([c[3 + 2 * j], c[4 + 2 * j], fq]));
  }
  // Node and apse: rates are slow; unwrap with zero predicted rate, then fit lines.
  const Omega = unwrapBoth(els.map((e) => e.Omega), 0);
  const varpi = unwrapBoth(els.map((e) => e.varpi), 0);
  const [Omega0, OmegaDot] = polyfit(t, Omega, 2);
  const [varpi0, varpiDot] = polyfit(t, varpi, 2);
  const mean = (f) => els.reduce((s, e) => s + f(e), 0) / els.length;
  const e = mean((x) => x.e);
  const i = mean((x) => x.i);
  // Mean distance ⟨r⟩ = a(1 + e²/2): matches the size of the real orbit better than osculating a.
  const a = mean((x) => x.rn) / (1 + (e * e) / 2);
  const el = { a, e, i, lambda0, n, ndot, varpi0, varpiDot, Omega0, OmegaDot, lib };

  let sum = 0, max = 0;
  for (let k = 0; k < sparse.length; k++) {
    const p = position(el, t[k]);
    const d = Math.hypot(p[0] - sparse[k].r[0], p[1] - sparse[k].r[1], p[2] - sparse[k].r[2]);
    sum += d * d;
    max = Math.max(max, d);
  }
  const rms = Math.sqrt(sum / sparse.length);
  console.log(
    `${moon.name.padEnd(10)} a ${a.toFixed(0).padStart(8)} km  e ${e.toFixed(4)}  i ${(i / DEG).toFixed(2).padStart(6)}°  ` +
      `P ${((2 * Math.PI) / n).toFixed(4)} d  lib ${lib.map((l) => `${(Math.hypot(l[0], l[1]) / DEG).toFixed(1)}°/${((2 * Math.PI) / l[2] / 365.25).toFixed(1)}y`).join(',') || '-'}  residual rms ${rms.toFixed(0)} km (${((rms / a) / DEG).toFixed(2)}°), max ${max.toFixed(0)} km (${((max / a) / DEG).toFixed(2)}°)`,
  );
  out.push({ ...moon, el, pole, rmsDeg: rms / a / DEG });
  // Five test epochs per moon, ICRF km (the test rotates to ecliptic itself).
  for (const k of [137, 911, 1500, 2203, 2871]) fixtures.push({ id: moon.id, jdTdb: sparse[k].jd, icrfKm: apply(transposeOf(toEq), sparse[k].r) });
}

function transposeOf(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

const fmt = (x) => Number(x.toPrecision(12));
const lines = out.map((m) => {
  const el = Object.fromEntries(Object.entries(m.el).map(([k, v]) => [k, k === 'lib' ? v.map((l) => l.map(fmt)) : fmt(v)]));
  return `  { id: '${m.id}', name: '${m.name}', parent: '${m.parent}', radiusKm: ${m.radius}, gm: ${m.gm}, albedo: ${m.albedo}, color: '${m.color}', pole: [${m.pole.map(fmt).join(', ')}], fitRmsDeg: ${fmt(m.rmsDeg).toFixed(3)},\n` +
    `    el: ${JSON.stringify(el).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')} },`;
});
const ts = `// Generated by tools/build-moons.mjs from JPL Horizons; do not edit by hand.
// Mean elements in an equatorial frame of the parent planet: 'pole' is its IAU
// mean pole (J2000), or the opposite pole where that makes the orbit prograde.
// Angles in radians, rates per day, t = days (TDB) from J2000; a in km.

import type { MoonElementsRecord } from './moons.ts';

export const MOON_ELEMENTS: MoonElementsRecord[] = [
${lines.join('\n')}
];
`;
writeFileSync(resolve(root, 'packages/astro/src/moonElements.ts'), ts);
writeFileSync(resolve(root, 'packages/astro/src/__fixtures__/horizons-moons.json'), JSON.stringify(fixtures, null, 1));
console.log(`Wrote ${out.length} moons.`);
