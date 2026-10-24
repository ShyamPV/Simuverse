/**
 * Other stars as places to visit. Any catalogue star can be a travel target;
 * the one you are near (or travelling to) is drawn as a disc by
 * StarSystemLayer, and the 4,800 exoplanet hosts (NASA Exoplanet Archive)
 * bring their planets, orbits and habitable zone. Exoplanet hosts that are
 * also HYG stars are snapped onto the HYG position, so the catalogue point,
 * its label and the system coincide.
 *
 * Keys: 'star:<HYG index>', 'tyc:<AT-HYG id>', 'exo:<system>', 'exop:<system>:<planet>'.
 */

import {
  AU, DEG, PC, type ExoOrbit, type Vec3, apparentMagnitude, exoplanetOrbit, exoplanetPosition, planetClass,
  planetClassLabel, spectralClassFromTeff, starPhysics,
} from '@simuverse/astro';
import { type CatalogEntry, type ExoSystem, type SearchEntry, type StarBuffers, loadExoplanets } from '@simuverse/data';
import type { Scene } from 'three';
import type { Frame, FrameGraph } from './frames.ts';
import type { LabelItem } from './LabelLayer.ts';
import { type ActivePlanet, type ActiveStar, StarSystemLayer } from './layers/StarSystemLayer.ts';
import type { RenderContext } from './layers/types.ts';
import type { OrbitTarget } from './OrbitCameraRig.ts';

const SUN_RADIUS = 695_700e3;
const EARTH_RADIUS = 6_371e3;
/** A star is drawn close up (and its planets shown) within this distance. */
const ACTIVE_RANGE_PC = 0.05;
const NEAREST_INTERVAL_S = 0.5;

/** What the engine knows about catalogue stars that StarSystems needs. */
export interface StarLookups {
  hyg(): StarBuffers | null;
  hygName(i: number): string | undefined;
  tyc(id: number): { pc: Vec3; absMag: number; bv: number } | null;
  hideHyg(i: number | null): void;
  hideTyc(id: number | null): void;
}

export interface StarDescription {
  kind: 'star' | 'exoplanet';
  name: string;
  subtitle: string;
  details: [string, string][];
  positionKm: Vec3;
  distanceM: number;
  magnitude?: number;
  approximate: boolean;
}

interface StarRecord {
  key: string;
  name: string;
  positionPc: Vec3;
  teff: number;
  radiusSun: number;
  lum: number;
  absMag: number;
  system: ExoSystem | null;
  hyg?: number;
  tyc?: number;
}

const hash01 = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
};

export class StarSystems {
  systems: ExoSystem[] = [];
  readonly layer: StarSystemLayer;
  private readonly orbits = new Map<string, ExoOrbit | null>();
  private readonly targets = new Map<string, OrbitTarget>();
  /** System index for each HYG star that hosts planets. */
  private readonly systemByHyg = new Map<number, number>();
  private matchedHyg = false;
  private lastNearest = -Infinity;
  private nearestKey: string | null = null;
  private nearestDistPc = Infinity;
  private activeRecord: StarRecord | null = null;
  private disposed = false;

  constructor(
    scene: Scene,
    private readonly frames: FrameGraph,
    private readonly sunFrame: Frame,
    dataBaseUrl: string,
    private readonly lookups: StarLookups,
  ) {
    this.layer = new StarSystemLayer(sunFrame);
    scene.add(this.layer.object);
    loadExoplanets(dataBaseUrl)
      .then((s) => {
        if (this.disposed) return;
        this.systems = s;
        this.matchHyg();
      })
      .catch((err) => console.error('Exoplanet catalogue failed to load', err));
  }

  /** Snaps exoplanet hosts onto their HYG stars (same direction within 3′, distance within 25%). */
  private matchHyg(): void {
    const stars = this.lookups.hyg();
    if (this.matchedHyg || !stars || !this.systems.length) return;
    this.matchedHyg = true;
    const cell = (v: Readonly<Vec3>) => {
      const r = Math.hypot(v[0], v[1], v[2]) || 1;
      const lat = Math.floor(Math.asin(v[2] / r) / DEG);
      const lon = Math.floor(((Math.atan2(v[1], v[0]) / DEG) + 360) % 360);
      return { lat, lon };
    };
    const grid = new Map<number, number[]>();
    const p = stars.positions;
    for (let i = 0; i < stars.count; i++) {
      if (stars.flags[i]! & 1) continue; // placeholder distance
      const c = cell([p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!]);
      const k = c.lat * 1000 + c.lon;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    }
    const cos3 = Math.cos(3 / 60 * DEG);
    for (const s of this.systems) {
      const v = s.positionPc;
      const d = Math.hypot(...v);
      const c = cell(v);
      let best = -1, bestCos = cos3;
      for (let dl = -1; dl <= 1; dl++) for (let dm = -1; dm <= 1; dm++) {
        for (const i of grid.get((c.lat + dl) * 1000 + ((c.lon + dm + 360) % 360)) ?? []) {
          const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
          const di = Math.hypot(x, y, z);
          const cosA = (x * v[0] + y * v[1] + z * v[2]) / (di * d);
          if (cosA > bestCos && Math.abs(di - d) < 0.25 * d) { bestCos = cosA; best = i; }
        }
      }
      if (best >= 0 && !this.systemByHyg.has(best)) {
        this.systemByHyg.set(best, s.index);
        s.positionPc = [p[best * 3]!, p[best * 3 + 1]!, p[best * 3 + 2]!];
        (s as ExoSystem & { hyg?: number }).hyg = best;
      }
    }
  }

  hygIndexOf(system: ExoSystem): number | undefined {
    return (system as ExoSystem & { hyg?: number }).hyg;
  }

  systemForHyg(i: number): ExoSystem | undefined {
    const k = this.systemByHyg.get(i);
    return k === undefined ? undefined : this.systems[k];
  }

  /** Physical record for a star-like key, or null. */
  private record(key: string): StarRecord | null {
    if (key.startsWith('exo:')) {
      const s = this.systems[Number(key.slice(4))];
      if (!s) return null;
      const absMag = s.vmag !== null ? s.vmag - 5 * Math.log10(s.distPc / 10) : 4.83 - 2.5 * Math.log10(s.lum);
      return { key, name: s.host, positionPc: s.positionPc, teff: s.teff, radiusSun: s.radiusSun, lum: s.lum, absMag, system: s, hyg: this.hygIndexOf(s) };
    }
    if (key.startsWith('star:')) {
      const stars = this.lookups.hyg();
      const i = Number(key.slice(5));
      if (!stars || !(i >= 0 && i < stars.count)) return null;
      const sys = this.systemForHyg(i);
      if (sys) return { ...this.record(`exo:${sys.index}`)!, key, hyg: i };
      const ph = starPhysics(stars.absMag[i]!, stars.bv[i]!);
      return {
        key, name: this.lookups.hygName(i) ?? `HYG star #${i}`,
        positionPc: [stars.positions[i * 3]!, stars.positions[i * 3 + 1]!, stars.positions[i * 3 + 2]!],
        teff: ph.teff, radiusSun: ph.radiusSun, lum: ph.lum, absMag: stars.absMag[i]!, system: null, hyg: i,
      };
    }
    if (key.startsWith('tyc:')) {
      const id = Number(key.slice(4));
      const t = this.lookups.tyc(id);
      if (!t) return null;
      const ph = starPhysics(t.absMag, t.bv);
      return { key, name: `AT-HYG ${id}`, positionPc: t.pc, teff: ph.teff, radiusSun: ph.radiusSun, lum: ph.lum, absMag: t.absMag, system: null, tyc: id };
    }
    return null;
  }

  isStarKey(key: string): boolean {
    return key.startsWith('star:') || key.startsWith('tyc:') || key.startsWith('exo:');
  }

  /** The system a key belongs to (a host star or one of its planets). */
  systemOf(key: string): ExoSystem | null {
    if (key.startsWith('exop:')) return this.systems[Number(key.split(':')[1])] ?? null;
    return this.record(key)?.system ?? null;
  }

  orbit(sys: number, planet: number): ExoOrbit | null {
    const k = `${sys}:${planet}`;
    if (this.orbits.has(k)) return this.orbits.get(k)!;
    const s = this.systems[sys]!;
    const p = s.planets[planet]!;
    const d = Math.hypot(...s.positionPc);
    const los: Vec3 = [s.positionPc[0] / d, s.positionPc[1] / d, s.positionPc[2] / d];
    const known = s.planets.map((x) => x.inclDeg).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const fallback = known.length ? known[Math.floor(known.length / 2)]! : 60;
    const o = exoplanetOrbit(p, s.massSun, los, hash01(s.host) * 2 * Math.PI, hash01(p.name), fallback);
    this.orbits.set(k, o);
    return o;
  }

  // ---------------------------------------------------------------- travel

  target(key: string): OrbitTarget | undefined {
    const known = this.targets.get(key);
    if (known) return known;
    if (key.startsWith('exop:')) {
      const [, si, pj] = key.split(':').map(Number) as [unknown, number, number];
      const s = this.systems[si];
      const p = s?.planets[pj];
      const o = p ? this.orbit(si, pj) : null;
      const host = this.target(`exo:${si}`);
      if (!p || !o || !host) return undefined;
      const frame = this.frames.get(key) ?? this.frames.add(key, host.frame.id, (t, out) => exoplanetPosition(o, t.jdTdb, out));
      const t = { id: key, frame, radius: p.radiusEarth * EARTH_RADIUS };
      this.targets.set(key, t);
      return t;
    }
    const r = this.record(key);
    if (!r) return undefined;
    // A HYG star with planets and its 'exo:' key share one frame.
    const frameId = r.system ? `fixed:exo:${r.system.index}` : `fixed:${key}`;
    const m: Vec3 = [r.positionPc[0] * PC, r.positionPc[1] * PC, r.positionPc[2] * PC];
    const frame = this.frames.get(frameId) ?? this.frames.add(frameId, this.sunFrame.id, (_t, out) => {
      out[0] = m[0]; out[1] = m[1]; out[2] = m[2];
    });
    frame.origin[0] = m[0]; frame.origin[1] = m[1]; frame.origin[2] = m[2];
    const t = { id: key, frame, radius: r.radiusSun * SUN_RADIUS };
    this.targets.set(key, t);
    return t;
  }

  viewDistance(key: string): number {
    if (key.startsWith('exop:')) {
      const t = this.target(key);
      return Math.max((t?.radius ?? EARTH_RADIUS) * 4, 2e7);
    }
    const r = this.record(key);
    if (!r) return AU;
    const radius = r.radiusSun * SUN_RADIUS;
    if (!r.system) return radius * 12;
    // Frame the whole system: the outermost orbit (or the habitable zone) fills the view.
    let outer = r.system.hz.outer * AU;
    r.system.planets.forEach((_, j) => {
      const o = this.orbit(r.system!.index, j);
      if (o) outer = Math.max(outer, o.a * (1 + o.e));
    });
    return Math.max(outer * 2.6, radius * 12);
  }

  /** Direction (from the target) to arrive from, or null to keep the approach direction. */
  arrivalDirection(key: string, jd: number): Vec3 | null {
    if (key.startsWith('exop:')) {
      const [, si, pj] = key.split(':').map(Number) as [unknown, number, number];
      const o = this.orbit(si, pj);
      if (!o) return null;
      // Three-quarter lit view: between the star direction and the orbit's forward direction, a little above the plane.
      const p = exoplanetPosition(o, jd);
      const r = Math.hypot(...p) || 1;
      const toStar: Vec3 = [-p[0] / r, -p[1] / r, -p[2] / r];
      const n = o.normal;
      const side: Vec3 = [n[1] * toStar[2] - n[2] * toStar[1], n[2] * toStar[0] - n[0] * toStar[2], n[0] * toStar[1] - n[1] * toStar[0]];
      const c = Math.cos(50 * DEG), s = Math.sin(50 * DEG);
      return [toStar[0] * c + side[0] * s + n[0] * 0.3, toStar[1] * c + side[1] * s + n[1] * 0.3, toStar[2] * c + side[2] * s + n[2] * 0.3];
    }
    const r = this.record(key);
    if (!r?.system) return null;
    const o = this.orbit(r.system.index, 0);
    if (!o) return null;
    // 55° above the orbital plane, on our side of the system.
    const d = Math.hypot(...r.positionPc);
    const toward: Vec3 = [-r.positionPc[0] / d, -r.positionPc[1] / d, -r.positionPc[2] / d];
    const n: Vec3 = o.normal[0] * toward[0] + o.normal[1] * toward[1] + o.normal[2] * toward[2] >= 0 ? o.normal : [-o.normal[0], -o.normal[1], -o.normal[2]];
    const c = Math.cos(55 * DEG), s = Math.sin(55 * DEG);
    return [n[0] * s + toward[0] * c, n[1] * s + toward[1] * c, n[2] * s + toward[2] * c];
  }

  // ---------------------------------------------------------------- per frame

  /**
   * Picks the star to draw close up: the travel/orbit target if it is a star
   * (or a planet's host), else the nearest exoplanet host or HYG star within range.
   */
  update(ctx: RenderContext, camPc: Readonly<Vec3>, focusKey: string | null): void {
    this.matchHyg();
    const now = performance.now() / 1000;
    if (now - this.lastNearest > NEAREST_INTERVAL_S) {
      this.lastNearest = now;
      this.findNearest(camPc);
    }
    let key: string | null = null;
    if (focusKey?.startsWith('exop:')) key = `exo:${focusKey.split(':')[1]}`;
    else if (focusKey && this.isStarKey(focusKey)) key = focusKey;
    if (key && this.distancePc(key, camPc) > ACTIVE_RANGE_PC * 40) key = null;
    if (!key && this.nearestKey && this.nearestDistPc < ACTIVE_RANGE_PC) key = this.nearestKey;
    this.activate(key);
    this.layer.update(ctx);
  }

  private distancePc(key: string, camPc: Readonly<Vec3>): number {
    const r = this.record(key);
    if (!r) return Infinity;
    return Math.hypot(r.positionPc[0] - camPc[0], r.positionPc[1] - camPc[1], r.positionPc[2] - camPc[2]);
  }

  private findNearest(camPc: Readonly<Vec3>): void {
    let best: string | null = null, bestD = Infinity;
    for (const s of this.systems) {
      const d = Math.hypot(s.positionPc[0] - camPc[0], s.positionPc[1] - camPc[1], s.positionPc[2] - camPc[2]);
      if (d < bestD) { bestD = d; best = `exo:${s.index}`; }
    }
    const stars = this.lookups.hyg();
    if (stars) {
      const p = stars.positions;
      for (let i = 0; i < stars.count; i++) {
        const d = Math.hypot(p[i * 3]! - camPc[0], p[i * 3 + 1]! - camPc[1], p[i * 3 + 2]! - camPc[2]);
        if (d < bestD && !this.systemByHyg.has(i)) { bestD = d; best = `star:${i}`; }
      }
    }
    this.nearestKey = best;
    this.nearestDistPc = bestD;
  }

  /** Nearest star (any catalogue) to the camera, parsecs — for fly-speed scaling. */
  get nearestDistancePc(): number {
    return this.nearestDistPc;
  }

  get nearestStarKey(): string | null {
    return this.nearestKey;
  }

  /** HYG index of the star drawn close up (its catalogue point and label give way to the disc). */
  get activeHyg(): number | undefined {
    return this.activeRecord?.hyg;
  }

  private activate(key: string | null): void {
    const current = this.activeRecord;
    // Planets' host and the HYG alias of an exo system are the same place.
    const r = key ? this.record(key) : null;
    const sameSystem = !!(r?.system && current?.system === r.system);
    if ((r?.key ?? null) === (current?.key ?? null) || sameSystem) return;
    this.activeRecord = r;
    this.lookups.hideHyg(r?.hyg ?? null);
    this.lookups.hideTyc(r?.tyc ?? null);
    if (!r) {
      this.layer.setActive(null);
      return;
    }
    const sys = r.system;
    const planets: ActivePlanet[] = sys
      ? sys.planets.map((p, j) => {
        const cls = planetClass(p.radiusEarth);
        const hot = (p.eqTempK ?? 0) > 1000;
        const color = cls === 'giant' ? (hot ? '#6b4436' : (p.eqTempK ?? 200) < 150 ? '#d8d0b8' : '#d6bd92')
          : cls === 'neptune' ? '#7fa6e0' : cls === 'sub-neptune' ? '#9fc3d6' : hot ? '#7a4a3a' : '#a39282';
        return {
          key: `exop:${sys.index}:${j}`, name: p.name, orbit: this.orbit(sys.index, j), radiusM: p.radiusEarth * EARTH_RADIUS,
          color, banded: cls === 'giant' || cls === 'neptune',
        };
      })
      : [];
    const star: ActiveStar = {
      key: r.key, name: r.name, positionM: [r.positionPc[0] * PC, r.positionPc[1] * PC, r.positionPc[2] * PC],
      radiusM: r.radiusSun * SUN_RADIUS, teff: r.teff, absMag: r.absMag, planets,
      hz: sys ? { inner: sys.hz.inner * AU, outer: sys.hz.outer * AU } : null,
    };
    this.layer.setActive(star);
  }

  /** Re-applies point hiding (tiles may have reloaded) — cheap, call occasionally. */
  refreshHidden(): void {
    const r = this.activeRecord;
    this.lookups.hideTyc(r?.tyc ?? null);
  }

  // ---------------------------------------------------------------- picking, labels, info

  pick(consider: (key: string, rel: Readonly<Vec3>, reachPx: number, bias?: number) => void): void {
    if (!this.layer.active) return;
    for (const p of this.layer.planets) consider(p.view.key, p.view.rel, Math.max(p.view.radiusPx, 10), -0.1);
    const st = this.layer.star;
    if (st.radiusPx > 3) consider(this.layer.active.key, st.rel, st.radiusPx, -0.05);
  }

  labels(project: (rel: Readonly<Vec3>) => [number, number] | null, free: (x: number, y: number) => boolean, placed: [number, number][]): LabelItem[] {
    const out: LabelItem[] = [];
    const a = this.layer.active;
    if (!a) return out;
    const st = this.layer.star;
    const s = project(st.rel);
    if (s && free(s[0], s[1])) {
      placed.push(s);
      out.push({ key: a.key, text: a.name, kind: 'star', x: s[0], y: s[1], marker: false, offset: Math.max(st.radiusPx, 4) + 6 });
    }
    // Planets nearest the camera first; skip those lost in the star's glare.
    const views = this.layer.planets.map((p) => p.view).sort((x, y) => x.distance - y.distance);
    for (const v of views) {
      const sp = project(v.rel);
      if (!sp || !free(sp[0], sp[1])) continue;
      if (s && Math.hypot(sp[0] - s[0], sp[1] - s[1]) < Math.max(st.radiusPx, 6) + 4) continue;
      placed.push(sp);
      const letter = v.name.startsWith(a.name) ? v.name.slice(a.name.length).trim() : v.name;
      out.push({ key: v.key, text: v.radiusPx > 20 ? v.name : letter || v.name, kind: 'body', x: sp[0], y: sp[1], marker: v.radiusPx < 2.5, offset: Math.max(v.radiusPx, 3) + 6, color: v.color });
    }
    return out;
  }

  /** Camera-relative vector (metres) to an exoplanet or system key, when it is placed. */
  selectionRel(key: string, camPc: Readonly<Vec3>, out: Vec3): Vec3 | null {
    if (key.startsWith('exop:')) {
      const v = this.layer.planets.find((p) => p.view.key === key)?.view;
      if (v) {
        out[0] = v.rel[0]; out[1] = v.rel[1]; out[2] = v.rel[2];
        return out;
      }
      key = `exo:${key.split(':')[1]}`;
    }
    if (!key.startsWith('exo:')) return null;
    const s = this.systems[Number(key.slice(4))];
    if (!s) return null;
    out[0] = (s.positionPc[0] - camPc[0]) * PC;
    out[1] = (s.positionPc[1] - camPc[1]) * PC;
    out[2] = (s.positionPc[2] - camPc[2]) * PC;
    return out;
  }

  /** Planet-system facts to add to a star's info. */
  systemDetails(s: ExoSystem): [string, string][] {
    const n = s.planets.length;
    const details: [string, string][] = [
      ['Planets', `${n} known (NASA Exoplanet Archive)`],
      ['Star', `${s.spectralType ?? `${spectralClassFromTeff(s.teff)} type`} · ${Math.round(s.teff).toLocaleString('en-US')} K`],
      ['Radius · mass', `${s.radiusSun.toPrecision(2)} R☉ · ${s.massSun.toPrecision(2)} M☉`],
      ['Luminosity', `${s.lum < 0.01 ? s.lum.toExponential(1) : s.lum.toPrecision(2)} L☉`],
      ['Habitable zone', `${s.hz.inner.toPrecision(2)}–${s.hz.outer.toPrecision(2)} AU (conservative)`],
    ];
    if (s.starCount > 1) details.push(['Stars in system', String(s.starCount)]);
    return details;
  }

  describe(key: string, jd: number): StarDescription | null {
    if (key.startsWith('exo:')) {
      const s = this.systems[Number(key.slice(4))];
      if (!s) return null;
      const r = this.record(key)!;
      const km: Vec3 = [s.positionPc[0] * PC / 1000, s.positionPc[1] * PC / 1000, s.positionPc[2] * PC / 1000];
      return {
        kind: 'star', name: s.host, subtitle: s.planets.length > 1 ? 'Planetary system' : 'Star with a planet',
        details: this.systemDetails(s), positionKm: km, distanceM: s.distPc * PC,
        magnitude: s.vmag ?? apparentMagnitude(r.absMag, s.distPc), approximate: false,
      };
    }
    if (key.startsWith('exop:')) {
      const [, si, pj] = key.split(':').map(Number) as [unknown, number, number];
      const s = this.systems[si];
      const p = s?.planets[pj];
      if (!s || !p) return null;
      const o = this.orbit(si, pj);
      const off = o ? exoplanetPosition(o, jd) : [0, 0, 0];
      const km: Vec3 = [(s.positionPc[0] * PC + off[0]!) / 1000, (s.positionPc[1] * PC + off[1]!) / 1000, (s.positionPc[2] * PC + off[2]!) / 1000];
      const aAU = o ? o.a / AU : p.aAU;
      const inHz = aAU !== null && aAU >= s.hz.inner && aAU <= s.hz.outer;
      const details: [string, string][] = [
        ['Radius', `${p.radiusEarth.toPrecision(3)} R⊕${p.radiusMeasured ? '' : ' (estimated from mass)'}`],
      ];
      if (p.massEarth !== null) details.push(['Mass', `${p.massEarth.toPrecision(3)} M⊕${p.massEarth > 50 ? ` (${(p.massEarth / 317.83).toPrecision(3)} M♃)` : ''}`]);
      if (o) details.push(['Orbit', `${(o.a / AU).toPrecision(3)} AU · ${o.periodDays < 2 ? `${(o.periodDays * 24).toPrecision(3)} h` : `${o.periodDays.toPrecision(4)} days`}${o.e > 0.05 ? ` · e ${o.e.toFixed(2)}` : ''}`]);
      if (p.eqTempK !== null) details.push(['Equilibrium temp.', `${Math.round(p.eqTempK)} K (${Math.round(p.eqTempK - 273)} °C)`]);
      details.push(['Habitable zone', inHz ? 'inside (conservative)' : aAU !== null && aAU < s.hz.inner ? 'too close to its star' : 'beyond it']);
      if (p.discYear) details.push(['Discovered', `${p.discYear}${p.method ? ` · ${p.method}` : ''}${p.facility ? ` · ${p.facility}` : ''}`]);
      details.push(['Orbit orientation', o && !o.approximatePhase ? 'phase from transit timing; node estimated' : 'estimated (not in the catalogue)']);
      return {
        kind: 'exoplanet', name: p.name, subtitle: planetClassLabel(p.radiusEarth, p.eqTempK), details, positionKm: km,
        distanceM: s.distPc * PC, approximate: true,
      };
    }
    return null;
  }

  /** Catalogue entries: every exoplanet, and hosts that aren't already named HYG stars. */
  catalogEntries(namedHyg: (i: number) => boolean): CatalogEntry[] {
    const out: CatalogEntry[] = [];
    for (const s of this.systems) {
      const hyg = this.hygIndexOf(s);
      const rank = Math.min(100, 30 + 8 * Math.log10(Math.max(s.distPc, 1)));
      if (hyg === undefined || !namedHyg(hyg)) {
        out.push({
          key: `exo:${s.index}`, ref: s.host, name: s.host, aliases: [], category: 'star',
          type: `${s.spectralType ?? `${spectralClassFromTeff(s.teff)}-type star`} with ${s.planets.length} planet${s.planets.length === 1 ? '' : 's'}`,
          distanceM: s.distPc * PC, radiusM: s.radiusSun * SUN_RADIUS, luminositySun: s.lum, temperatureK: s.teff,
          magnitude: s.vmag ?? undefined, raDeg: s.raDeg, decDeg: s.decDeg, rank: rank + 10,
          extra: [['Habitable zone', `${s.hz.inner.toPrecision(2)}–${s.hz.outer.toPrecision(2)} AU`]],
        });
      }
      s.planets.forEach((p, j) => {
        const o = this.orbit(s.index, j);
        const aAU = o ? o.a / AU : p.aAU;
        const inHz = aAU !== null && aAU >= s.hz.inner && aAU <= s.hz.outer;
        const extra: [string, string][] = [['Host star', `${s.host} (${s.spectralType ?? spectralClassFromTeff(s.teff)})`]];
        if (aAU !== null) extra.push(['Orbit', `${aAU.toPrecision(3)} AU${inHz ? ' · in the habitable zone' : ''}`]);
        if (p.eqTempK !== null) extra.push(['Equilibrium temp.', `${Math.round(p.eqTempK)} K`]);
        if (p.method) extra.push(['Detected by', p.method + (p.facility ? ` (${p.facility})` : '')]);
        out.push({
          key: `exop:${s.index}:${j}`, ref: p.name, name: p.name, aliases: [], category: 'exoplanet',
          type: planetClassLabel(p.radiusEarth, p.eqTempK), distanceM: s.distPc * PC, radiusM: p.radiusEarth * EARTH_RADIUS,
          massKg: p.massEarth !== null ? p.massEarth * 5.9722e24 : undefined, periodDays: o?.periodDays ?? p.periodDays ?? undefined,
          temperatureK: p.eqTempK ?? undefined,
          raDeg: s.raDeg, decDeg: s.decDeg, discovered: p.discYear ? { year: p.discYear, by: p.facility ?? p.method ?? 'unknown' } : undefined,
          rank: rank + 5 - (inHz ? 6 : 0), approximate: true, extra,
        });
      });
    }
    return out;
  }

  searchEntries(): SearchEntry[] {
    const out: SearchEntry[] = [];
    for (const s of this.systems) {
      const n = s.planets.length;
      const rank = Math.min(100, 30 + 8 * Math.log10(Math.max(s.distPc, 1)));
      out.push({ key: `exo:${s.index}`, ref: s.host, name: s.host, kind: 'system', rank, detail: `${n} planet${n === 1 ? '' : 's'} · ${formatPc(s.distPc)}` });
      s.planets.forEach((p, j) => {
        out.push({
          key: `exop:${s.index}:${j}`, ref: p.name, name: p.name, kind: 'exoplanet', rank: rank + 5,
          detail: `${planetClassLabel(p.radiusEarth, p.eqTempK)} · ${formatPc(s.distPc)}`,
        });
      });
    }
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.layer.dispose();
  }
}

function formatPc(pc: number): string {
  const ly = pc * 3.26156;
  return ly < 100 ? `${ly.toFixed(1)} ly` : `${Math.round(ly).toLocaleString('en-US')} ly`;
}
