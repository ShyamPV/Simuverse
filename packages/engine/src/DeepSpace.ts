/**
 * Everything beyond the solar system's bright-star sky: streamed Gaia/Tycho
 * stars, the Milky Way, deep-sky objects, catalogue galaxies and the
 * procedural cosmic web — plus the fixed orbit centres (Galactic Centre,
 * Local Group, Virgo, Laniakea), picking, labels and info for those objects.
 */

import {
  DEG, EQUATORIAL_TO_ECLIPTIC, GALACTIC_TO_EQUATORIAL, KPC, MPC, PC, type ObserverState, type Vec3, apparentFixed,
  apparentMagnitude, mulMat3Vec, sphericalToCartesian,
} from '@simuverse/astro';
import {
  type Constellations, DEEP_SKY_TYPE_LABEL, type DeepSkyObject, GALAXY_FLAG, type GalaxyCatalog, type GalaxyName,
  type OctreeIndex, TileLoader, constellationAt, loadDeepSky, loadGalaxyCatalog, loadStarOctreeIndex, morphologyLabel,
} from '@simuverse/data';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Frame, FrameGraph } from './frames.ts';
import type { LabelItem } from './LabelLayer.ts';
import { CosmicWebLayer } from './layers/CosmicWebLayer.ts';
import { DeepSkyLayer } from './layers/DeepSkyLayer.ts';
import { GalaxyLayer } from './layers/GalaxyLayer.ts';
import { type MilkyWayMeta, MilkyWayLayer } from './layers/MilkyWayLayer.ts';
import { StarOctreeLayer } from './layers/StarOctreeLayer.ts';
import type { StarLayer } from './layers/StarLayer.ts';
import type { RenderContext } from './layers/types.ts';
import { VolumePass } from './layers/VolumePass.ts';
import type { OrbitTarget } from './OrbitCameraRig.ts';
import type { LadderId } from './scale.ts';

/** Norma cluster (ACO 3627), near the Great Attractor at the heart of Laniakea: galactic l, b and distance. */
const GREAT_ATTRACTOR = { l: 325.3, b: -7.3, distMpc: 66 };
const GALAXY_LABEL_MAX = 18;
const DSO_LABEL_MAX = 16;
/** Deep-sky objects fainter than this (from the camera) are only labelled when resolved. */
const DSO_LABEL_MAG = 11;

export type DeepSelectionKind = 'galaxy' | 'nebula' | 'cluster' | 'star';

export interface DeepSelection {
  kind: DeepSelectionKind;
  name: string;
  subtitle: string;
  details: [string, string][];
  /** Barycentric-ish (Sun-centred) position, km, ecliptic — for apparent places and rise/set. */
  positionKm: Vec3;
  distanceM?: number;
  magnitude?: number;
  approximate: boolean;
}

/** Quality-preset settings that bound deep-space rendering cost. */
export interface DeepQuality {
  volumeSteps: number;
  volumeScale: number;
  /** Most catalogue stars resident on the GPU. */
  starBudget: number;
  /** Most procedural galaxies resident on the GPU. */
  webBudget: number;
}

export interface DeepSpaceStats {
  octreeStars: number;
  proceduralGalaxies: number;
  catalogGalaxies: number;
}

export class DeepSpace {
  readonly milkyWay: MilkyWayLayer;
  private octree: StarOctreeLayer | null = null;
  private galaxies: GalaxyLayer | null = null;
  private galaxyNames = new Map<number, GalaxyName>();
  private namedGalaxies: GalaxyName[] = [];
  private deepSky: DeepSkyLayer | null = null;
  private web: CosmicWebLayer;
  private readonly tiles = new TileLoader();
  /** Ray-marched volumes (Milky Way model, nearby nebulae), rendered at reduced resolution. */
  private readonly volumes = new VolumePass();
  private readonly tmp: Vec3 = [0, 0, 0];
  private readonly targets = new Map<string, OrbitTarget>();
  private octreeIndex: OctreeIndex | null = null;
  private pendingOctree = false;
  private disposed = false;
  private starBudget = 1_500_000;
  showGalaxies = true;
  showDeepSky = true;
  showMilkyWay = true;

  constructor(
    private readonly scene: Scene,
    private readonly frames: FrameGraph,
    private readonly sunFrame: Frame,
    private readonly dataBaseUrl: string,
  ) {
    this.web = new CosmicWebLayer(this.tiles, sunFrame);
    scene.add(this.web.object);

    // Galactic Centre and the "universe" centre (us) are known up front.
    scene.add(this.volumes.composite);
    const mw = new MilkyWayLayer(dataBaseUrl, sunFrame, this.volumes);
    this.milkyWay = mw;
    scene.add(mw.object);
    fetch(new URL('milkyway/milkyway.json', dataBaseUrl))
      .then((r) => r.json() as Promise<MilkyWayMeta>)
      .then((meta) => mw.setMeta(meta))
      .catch(() => undefined);
    this.addFixedTarget('galaxy', mw.centerOffsetPc.map((v) => v * PC) as Vec3);
    this.targets.set('universe', { id: 'universe', frame: sunFrame, radius: 0 });

    loadGalaxyCatalog(dataBaseUrl)
      .then(({ catalog, names }) => this.onGalaxies(catalog, names))
      .catch((err) => console.error('Galaxy catalogue failed to load', err));
    loadDeepSky(dataBaseUrl)
      .then((objects) => {
        if (this.disposed) return;
        this.deepSky = new DeepSkyLayer(objects, sunFrame, this.volumes);
        scene.add(this.deepSky.object);
      })
      .catch((err) => console.error('Deep-sky catalogue failed to load', err));
    loadStarOctreeIndex(dataBaseUrl)
      .then((index) => {
        this.octreeIndex = index;
        this.pendingOctree = true;
      })
      .catch((err) => console.error('Star octree failed to load', err));
  }

  /** The octree layer clones the bright-star layer's material, so it waits for it. */
  attachStarTemplate(template: StarLayer): void {
    if (!this.octreeIndex || !this.pendingOctree || this.octree) return;
    this.pendingOctree = false;
    this.octree = new StarOctreeLayer(this.octreeIndex, this.dataBaseUrl, this.tiles, this.sunFrame, template);
    this.octree.budget = this.starBudget;
    this.scene.add(this.octree.object);
  }

  private onGalaxies(catalog: GalaxyCatalog, names: GalaxyName[]): void {
    if (this.disposed) return;
    this.galaxyNames = new Map(names.map((n) => [n.i, n]));
    this.namedGalaxies = names;
    const nameOf = (i: number) => this.galaxyNames.get(i)?.name ?? '';
    // The Magellanic Clouds are already in the background photograph of the sky.
    this.galaxies = new GalaxyLayer(catalog, this.sunFrame, (i) => /Magellanic/.test(nameOf(i)));
    this.scene.add(this.galaxies.object);
    const find = (name: string) => names.find((n) => n.name === name || n.aliases.includes(name))?.i;
    const pos = (i: number | undefined): Vec3 | null =>
      i === undefined ? null : [catalog.positions[i * 3]! * MPC, catalog.positions[i * 3 + 1]! * MPC, catalog.positions[i * 3 + 2]! * MPC];
    // Local Group barycentre: roughly midway between the Milky Way and Andromeda (comparable masses).
    const m31 = pos(find('Andromeda Galaxy'));
    const gc = this.targets.get('galaxy')!.frame.origin;
    if (m31) this.addFixedTarget('local-group', [(gc[0] + m31[0]) / 2, (gc[1] + m31[1]) / 2, (gc[2] + m31[2]) / 2]);
    const m87 = pos(find('M87'));
    if (m87) this.addFixedTarget('virgo', m87);
    const ga = galacticToEcliptic(GREAT_ATTRACTOR.l, GREAT_ATTRACTOR.b);
    this.addFixedTarget('laniakea', [ga[0] * GREAT_ATTRACTOR.distMpc * MPC, ga[1] * GREAT_ATTRACTOR.distMpc * MPC, ga[2] * GREAT_ATTRACTOR.distMpc * MPC]);
  }

  private addFixedTarget(id: string, offsetM: Vec3, radius = 0): OrbitTarget {
    const frameId = `fixed:${id}`;
    const frame = this.frames.get(frameId) ?? this.frames.add(frameId, this.sunFrame.id, (_t, o) => {
      o[0] = offsetM[0]; o[1] = offsetM[1]; o[2] = offsetM[2];
    });
    frame.origin[0] = offsetM[0];
    frame.origin[1] = offsetM[1];
    frame.origin[2] = offsetM[2];
    const t = { id, frame, radius };
    this.targets.set(id, t);
    return t;
  }

  /** Orbit target for ladder centres and selectable deep objects ('gal:i', 'dso:i'). */
  target(id: string): OrbitTarget | undefined {
    const known = this.targets.get(id);
    if (known) return known;
    if (id.startsWith('gal:') && this.galaxies) {
      const i = Number(id.slice(4));
      const c = this.galaxies.catalog;
      const r = c.radiusKpc[i]! * KPC;
      return this.addFixedTarget(id, [c.positions[i * 3]! * MPC, c.positions[i * 3 + 1]! * MPC, c.positions[i * 3 + 2]! * MPC], r * 0.2);
    }
    if (id.startsWith('dso:') && this.deepSky) {
      const i = Number(id.slice(4));
      const p = this.deepSky.positionsPc[i];
      if (!p) return undefined;
      return this.addFixedTarget(id, [p[0] * PC, p[1] * PC, p[2] * PC], this.deepSky.radiusPc[i]! * PC * 0.3);
    }
    return undefined;
  }

  /** A sensible viewing distance for a target. */
  viewDistance(id: string): number {
    if (id === 'galaxy') return 70 * KPC;
    if (id === 'local-group') return 4 * MPC;
    if (id === 'virgo') return 60 * MPC;
    if (id === 'laniakea') return 400 * MPC;
    if (id === 'universe') return 45_000 * MPC;
    if (id.startsWith('gal:') && this.galaxies) return Math.max(this.galaxies.catalog.radiusKpc[Number(id.slice(4))]! * KPC * 5, 20 * KPC);
    if (id.startsWith('dso:') && this.deepSky) return Math.max(this.deepSky.radiusPc[Number(id.slice(4))]! * PC * 6, 2 * PC);
    return 10 * KPC;
  }

  /** World direction from which to view a ladder target (above the Galactic plane for the Galaxy). */
  preferredViewDirection(id: LadderId | string): Vec3 | null {
    if (id === 'galaxy' || id === 'local-group') {
      // 35° above the Galactic plane, on the Sun's side.
      const up = galacticToEcliptic(0, 90);
      const sunSide = galacticToEcliptic(180, 0);
      const a = 35 * DEG;
      return [up[0] * Math.sin(a) + sunSide[0] * Math.cos(a), up[1] * Math.sin(a) + sunSide[1] * Math.cos(a), up[2] * Math.sin(a) + sunSide[2] * Math.cos(a)];
    }
    return null;
  }

  update(ctx: RenderContext, skyVisibility: number): void {
    this.milkyWay.enabled = this.showMilkyWay;
    this.milkyWay.update(ctx);
    const photo = this.milkyWay.backgroundWeight;
    this.octree?.update(ctx);
    if (this.galaxies) {
      this.galaxies.enabled = this.showGalaxies;
      this.galaxies.update(ctx, photo, skyVisibility);
    }
    if (this.deepSky) {
      this.deepSky.enabled = this.showDeepSky;
      // Extended objects: fixed magnitude reference, brightened only by the gentle extended gain.
      this.deepSky.update(ctx, 5.5, skyVisibility);
    }
    this.web.enabled = this.showGalaxies;
    this.web.update(ctx);
  }

  /** Star photometry (shared with the bright-star layer) for the streamed Gaia/Tycho stars. */
  setStarPhotometry(magLimit: number): void {
    this.octree?.setMagLimit(magLimit);
  }

  /** Galaxy-point photometry: scale-referenced in Universe view (see galaxyMagRef). */
  setGalaxyPhotometry(magRef: number, magLimit: number): void {
    this.galaxies?.setPhotometry(magRef, magLimit);
    this.web.setPhotometry(magRef, magLimit);
  }

  setQuality(q: DeepQuality): void {
    this.milkyWay.steps = q.volumeSteps;
    this.volumes.scale = q.volumeScale;
    this.starBudget = q.starBudget;
    if (this.octree) this.octree.budget = q.starBudget;
    this.web.budget = q.webBudget;
  }

  /** Renders the volume target; call before the main scene render. */
  renderVolumes(renderer: WebGLRenderer, camera: PerspectiveCamera): void {
    this.volumes.render(renderer, camera);
  }

  get stats(): DeepSpaceStats {
    return {
      octreeStars: this.octree?.loadedStars ?? 0,
      proceduralGalaxies: this.web.loadedGalaxies,
      catalogGalaxies: this.galaxies?.catalog.count ?? 0,
    };
  }

  // ---------------------------------------------------------------- picking, labels, selection

  /**
   * Offers deep objects to a picker. `consider(key, relMetres, reachPx, bias)`
   * is the engine's screen-space nearest test.
   */
  pick(consider: (key: string, rel: Readonly<Vec3>, reachPx: number, bias?: number) => void, pxPerRad: number, magLimit: number): void {
    const g = this.galaxies;
    if (g?.object.visible) {
      const c = g.catalog;
      const cam = g.camMpc;
      const rel: Vec3 = [0, 0, 0];
      for (let i = 0; i < c.count; i++) {
        rel[0] = (c.positions[i * 3]! - cam[0]) * MPC;
        rel[1] = (c.positions[i * 3 + 1]! - cam[1]) * MPC;
        rel[2] = (c.positions[i * 3 + 2]! - cam[2]) * MPC;
        const d = Math.hypot(...rel);
        const rpx = ((c.radiusKpc[i]! * KPC) / d) * pxPerRad;
        const app = c.absMagV[i]! + 5 * Math.log10(d / PC / 10);
        if (rpx < 2 && app > magLimit + 1) continue;
        consider(`gal:${i}`, rel, Math.max(rpx, 8), app * 0.02);
      }
    }
    const ds = this.deepSky;
    if (ds?.object.visible) {
      const rel: Vec3 = [0, 0, 0];
      ds.objects.forEach((o, i) => {
        if (o.type === 'DrkN' || this.dsoApparentMag(i) === null) return;
        ds.relativeMetres(i, rel);
        const ang = ds.positionsPc[i] ? (ds.radiusPc[i]! * PC) / Math.hypot(...rel) : ((o.majAx ?? 1) / 2) * (DEG / 60);
        consider(`dso:${i}`, rel, Math.max(ang * pxPerRad, 9), o.messier ? -0.05 : 0.02);
      });
    }
  }

  /** Loaded Gaia/Tycho stars, for picking when nothing else is near the click. */
  pickStars(consider: (key: string, rel: Readonly<Vec3>, reachPx: number, bias?: number) => void, camPc: Readonly<Vec3>, magLimit: number): void {
    this.octree?.forEachStar(camPc, (tile, i, rel) => {
      const d = Math.hypot(rel[0], rel[1], rel[2]);
      const mag = apparentMagnitude(tile.absMag[i]!, d);
      if (mag > magLimit) return;
      consider(`tyc:${tile.ids[i]}`, [rel[0] * PC, rel[1] * PC, rel[2] * PC], 8, mag * 0.05);
    });
  }

  labels(
    project: (rel: Readonly<Vec3>) => [number, number] | null, free: (x: number, y: number) => boolean,
    placed: [number, number][], pxPerRad: number, magLimit: number, hidden: (rel: Readonly<Vec3>) => boolean,
  ): LabelItem[] {
    const out: LabelItem[] = [];
    const g = this.galaxies;
    if (g?.object.visible) {
      const c = g.catalog;
      const cam = g.camMpc;
      const cands: { i: number; score: number; rel: Vec3; rpx: number }[] = [];
      for (const n of this.namedGalaxies) {
        const i = n.i;
        const rel: Vec3 = [(c.positions[i * 3]! - cam[0]) * MPC, (c.positions[i * 3 + 1]! - cam[1]) * MPC, (c.positions[i * 3 + 2]! - cam[2]) * MPC];
        const d = Math.hypot(...rel);
        const rpx = ((c.radiusKpc[i]! * KPC) / d) * pxPerRad;
        const app = c.absMagV[i]! + 5 * Math.log10(d / PC / 10);
        if (rpx < 6 && app > magLimit - 1) continue;
        cands.push({ i, score: rpx * 2 - app, rel, rpx });
      }
      cands.sort((a, b) => b.score - a.score);
      let k = 0;
      for (const cnd of cands) {
        if (k >= GALAXY_LABEL_MAX) break;
        if (hidden(cnd.rel)) continue;
        const s = project(cnd.rel);
        if (!s || !free(s[0], s[1])) continue;
        placed.push(s);
        out.push({ key: `gal:${cnd.i}`, text: this.galaxyNames.get(cnd.i)!.name, kind: 'galaxy', x: s[0], y: s[1], marker: false, offset: Math.max(cnd.rpx * 0.6, 4) + 6 });
        k++;
      }
    }
    const ds = this.deepSky;
    if (ds?.object.visible) {
      const rel: Vec3 = [0, 0, 0];
      const cands: { i: number; score: number; rpx: number; rel: Vec3 }[] = [];
      ds.objects.forEach((o, i) => {
        if (!o.messier && !o.aliases.length && o.name === o.id) return;
        const mag = this.dsoApparentMag(i);
        if (mag === null) return;
        ds.relativeMetres(i, rel);
        const d = Math.hypot(...rel);
        const rpx = ds.positionsPc[i] ? ((ds.radiusPc[i]! * PC) / d) * pxPerRad : ((o.majAx ?? 1) / 2) * (DEG / 60) * pxPerRad;
        // Label what is resolved on screen or within reach of a telescope from here.
        if (rpx < 5 && mag > DSO_LABEL_MAG) return;
        cands.push({ i, score: rpx - mag + (o.messier ? 3 : 0), rpx, rel: [...rel] });
      });
      cands.sort((a, b) => b.score - a.score);
      let k = 0;
      for (const cnd of cands) {
        if (k >= DSO_LABEL_MAX) break;
        if (hidden(cnd.rel)) continue;
        const s = project(cnd.rel);
        if (!s || !free(s[0], s[1])) continue;
        placed.push(s);
        const o = ds.objects[cnd.i]!;
        const text = o.messier && o.name !== `M${o.messier}` ? `${o.name} (M${o.messier})` : o.name;
        out.push({ key: `dso:${cnd.i}`, text, kind: 'nebula', x: s[0], y: s[1], marker: false, offset: Math.max(cnd.rpx * 0.7, 4) + 6 });
        k++;
      }
    }
    return out;
  }

  /**
   * Apparent magnitude of a deep-sky object from the camera, or null when it
   * isn't meaningful: objects known only by direction lose their place once
   * the camera is more than a kiloparsec from home.
   */
  private dsoApparentMag(i: number): number | null {
    const ds = this.deepSky!;
    const o = ds.objects[i]!;
    const mag = o.mag ?? 9;
    const p = ds.positionsPc[i];
    const fromSun = Math.hypot(...ds.camPc);
    if (!p) return fromSun > 1000 ? null : mag;
    const d = Math.hypot(p[0] - ds.camPc[0], p[1] - ds.camPc[1], p[2] - ds.camPc[2]);
    return mag + 5 * Math.log10(Math.max(d, 1e-6) / o.distPc!);
  }

  /** Camera-relative vector (metres) to a deep selection. */
  selectionRel(key: string, camPc: Readonly<Vec3>, out: Vec3): Vec3 | null {
    if (key.startsWith('gal:') && this.galaxies) {
      const i = Number(key.slice(4));
      const c = this.galaxies.catalog, cam = this.galaxies.camMpc;
      out[0] = (c.positions[i * 3]! - cam[0]) * MPC;
      out[1] = (c.positions[i * 3 + 1]! - cam[1]) * MPC;
      out[2] = (c.positions[i * 3 + 2]! - cam[2]) * MPC;
      return out;
    }
    if (key.startsWith('dso:') && this.deepSky) return this.deepSky.relativeMetres(Number(key.slice(4)), out);
    if (key.startsWith('tyc:') && this.octree) {
      const hit = this.octree.findStar(Number(key.slice(4)));
      if (!hit) return null;
      const p = hit.tile.positions;
      out[0] = (hit.centerPc[0] + p[hit.i * 3]! - camPc[0]) * PC;
      out[1] = (hit.centerPc[1] + p[hit.i * 3 + 1]! - camPc[1]) * PC;
      out[2] = (hit.centerPc[2] + p[hit.i * 3 + 2]! - camPc[2]) * PC;
      return out;
    }
    return null;
  }

  /** Description of a deep selection; positions are Sun-centred (parallax from Earth's orbit is negligible). */
  describe(key: string): DeepSelection | null {
    if (key.startsWith('gal:') && this.galaxies) {
      const i = Number(key.slice(4));
      const c = this.galaxies.catalog;
      const n = this.galaxyNames.get(i);
      const distMpc = Math.hypot(c.positions[i * 3]!, c.positions[i * 3 + 1]!, c.positions[i * 3 + 2]!);
      const flags = c.flags[i]!;
      const source = flags & GALAXY_FLAG.LOCAL_GROUP ? 'McConnachie 2012 (Local Group)'
        : flags & GALAXY_FLAG.CF4_DISTANCE ? 'Cosmicflows-4 (redshift-independent)'
        : 'Redshift (Hubble flow, H₀ = 74.6), approximate';
      const diameterKpc = c.radiusKpc[i]! * 2;
      const details: [string, string][] = [
        ['Morphology', n?.hubble ? `${morphologyLabel(c.tType[i]!)} (${n.hubble})` : morphologyLabel(c.tType[i]!)],
        ['Diameter', `${diameterKpc.toFixed(diameterKpc < 10 ? 1 : 0)} kpc (${Math.round(diameterKpc * 3261.56).toLocaleString('en-US')} ly)`],
        ['Distance from', source],
      ];
      if (Number.isFinite(c.czKmS[i]!)) details.push(['Recession velocity', `${Math.round(c.czKmS[i]!).toLocaleString('en-US')} km/s`]);
      if (n?.aliases.length) details.push(['Also known as', n.aliases.slice(0, 3).join(', ')]);
      if (flags & GALAXY_FLAG.PA_UNKNOWN) details.push(['Orientation', 'not catalogued (shown at a random angle)']);
      return {
        kind: 'galaxy', name: n?.name ?? `2MRS galaxy #${i}`, subtitle: 'Galaxy', details,
        positionKm: [c.positions[i * 3]! * MPC / 1000, c.positions[i * 3 + 1]! * MPC / 1000, c.positions[i * 3 + 2]! * MPC / 1000],
        distanceM: distMpc * MPC, magnitude: c.appMagV[i]!,
        approximate: !!(flags & GALAXY_FLAG.REDSHIFT_DISTANCE),
      };
    }
    if (key.startsWith('dso:') && this.deepSky) {
      const i = Number(key.slice(4));
      const o = this.deepSky.objects[i]!;
      const dir = mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, sphericalToCartesian(o.ra * DEG, o.dec * DEG));
      const distM = o.distPc ? o.distPc * PC : undefined;
      // Without a distance, use a far placeholder so apparent-place maths still works (parallax-free).
      const far = (distM ?? 1e5 * PC) / 1000;
      const details: [string, string][] = [];
      if (o.distSrc) details.push(['Distance from', o.distSrc]);
      if (o.majAx) {
        const sizeArcmin = o.minAx ? `${o.majAx}′ × ${o.minAx}′` : `${o.majAx}′`;
        details.push(['Apparent size', sizeArcmin]);
        if (o.distPc) details.push(['Physical size', `${((o.majAx / 60) * DEG * o.distPc * 3.26156).toFixed(1)} ly across`]);
      }
      const aliases = o.aliases.filter((a) => a !== o.name);
      if (aliases.length) details.push(['Also known as', aliases.slice(0, 3).join(', ')]);
      const cluster = /Cl|Ass/.test(o.type);
      return {
        kind: cluster ? 'cluster' : 'nebula', name: o.name, subtitle: DEEP_SKY_TYPE_LABEL[o.type],
        details, positionKm: [dir[0] * far, dir[1] * far, dir[2] * far], distanceM: distM,
        magnitude: o.mag ?? undefined, approximate: !o.distPc || !!o.approx,
      };
    }
    if (key.startsWith('tyc:') && this.octree) {
      const id = Number(key.slice(4));
      const hit = this.octree.findStar(id);
      if (!hit) return null;
      const p = hit.tile.positions;
      const pc: Vec3 = [hit.centerPc[0] + p[hit.i * 3]!, hit.centerPc[1] + p[hit.i * 3 + 1]!, hit.centerPc[2] + p[hit.i * 3 + 2]!];
      const d = Math.hypot(...pc);
      return {
        kind: 'star', name: `AT-HYG ${id}`, subtitle: 'Star (Tycho-2 / Gaia DR3)',
        details: [['Absolute magnitude', hit.tile.absMag[hit.i]!.toFixed(2)], ['Catalogue', 'AT-HYG v4.0 (Gaia DR3 distance)']],
        positionKm: [pc[0] * PC / 1000, pc[1] * PC / 1000, pc[2] * PC / 1000], distanceM: d * PC,
        magnitude: apparentMagnitude(hit.tile.absMag[hit.i]!, d), approximate: false,
      };
    }
    return null;
  }

  /** Apparent place + constellation helper for the engine's info panel. */
  static apparent(obs: ObserverState, positionKm: Vec3, constellations: Constellations | null) {
    const p = apparentFixed(obs, positionKm);
    const con = constellations ? constellationAt(constellations, p.raJ2000 / DEG, p.decJ2000 / DEG) : undefined;
    return { place: p, constellation: con ? constellations![con]?.name : undefined };
  }

  dispose(): void {
    this.disposed = true;
    this.octree?.dispose();
    this.galaxies?.dispose();
    this.deepSky?.dispose();
    this.web.dispose();
    this.milkyWay.dispose();
    this.tiles.dispose();
    this.volumes.dispose();
  }
}

/** Galactic (l, b) in degrees → ecliptic unit vector. */
export function galacticToEcliptic(lDeg: number, bDeg: number): Vec3 {
  return mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, mulMat3Vec(GALACTIC_TO_EQUATORIAL, sphericalToCartesian(lDeg * DEG, bDeg * DEG)));
}
