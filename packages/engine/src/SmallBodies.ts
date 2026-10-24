/**
 * Asteroids, dwarf planets and comets (JPL SBDB) as frames orbiting the Sun,
 * with points, orbit lines, close-up spheres, labels, picking, travel targets
 * and apparent places for Sky view. Orbits are two-body (see astro/smallBodies).
 *
 * Keys: 'sb:<index>'.
 */

import {
  AU, type ObserverState, type Vec3, apparentFromVector, asteroidMagnitude, cometMagnitude,
  smallBodyPeriod, smallBodyPosition, C_KM_PER_DAY, type Ephemeris,
} from '@simuverse/astro';
import { type CatalogEntry, type SearchEntry, type SmallBody, loadSmallBodies } from '@simuverse/data';
import {
  BufferAttribute, BufferGeometry, Color, Group, Line, LineBasicMaterial, Mesh, Points, Quaternion, type Scene,
  type ShaderMaterial, Vector3,
} from 'three';
import type { Frame, FrameGraph } from './frames.ts';
import type { LabelItem } from './LabelLayer.ts';
import { createBodyGeometry, createBodyPointsMaterial, createPlanetMaterial } from './layers/bodyMaterials.ts';
import type { RenderContext } from './layers/types.ts';
import type { OrbitTarget } from './OrbitCameraRig.ts';

const ORBIT_SEGMENTS = 256;
const KM = 1000;
const COLORS: Record<SmallBody['kind'], string> = {
  'dwarf-planet': '#cdbfa9', tno: '#c9a68c', asteroid: '#a99c8c', comet: '#bfe3ff', interstellar: '#e0c2a2',
};
const KIND_LABEL: Record<SmallBody['kind'], string> = {
  'dwarf-planet': 'Dwarf planet', tno: 'Trans-Neptunian object', asteroid: 'Asteroid', comet: 'Comet', interstellar: 'Interstellar object',
};

export interface SmallBodyView {
  key: string;
  name: string;
  rel: Vec3;
  distance: number;
  radiusPx: number;
  magnitude: number;
}

interface Render {
  body: SmallBody;
  frame: Frame;
  radius: number;
  mesh: Mesh;
  material: ShaderMaterial;
  orbit: Line;
  orbitMaterial: LineBasicMaterial;
  orbitPoints: Vec3[];
  view: SmallBodyView;
}

export class SmallBodies {
  readonly object = new Group();
  bodies: SmallBody[] = [];
  private renders: Render[] = [];
  private points: Points | null = null;
  private readonly pointsMaterial = createBodyPointsMaterial();
  private readonly sphere = createBodyGeometry(48, 24);
  private readonly invCam = new Quaternion();
  private readonly v3 = new Vector3();
  private readonly tmp: Vec3 = [0, 0, 0];
  private readonly sunRel: Vec3 = [0, 0, 0];
  showOrbits = true;
  enabled = true;
  private disposed = false;

  constructor(scene: Scene, private readonly frames: FrameGraph, private readonly sunFrame: Frame, dataBaseUrl: string) {
    scene.add(this.object);
    loadSmallBodies(dataBaseUrl)
      .then((b) => {
        if (!this.disposed) this.build(b);
      })
      .catch((err) => console.error('Small-body catalogue failed to load', err));
  }

  private build(bodies: SmallBody[]): void {
    this.bodies = bodies;
    const n = bodies.length;
    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute('mag', new BufferAttribute(new Float32Array(n), 1));
    pg.setAttribute('visible', new BufferAttribute(new Float32Array(n), 1));
    const colors = new Float32Array(n * 3);
    this.renders = bodies.map((body, i) => {
      const el = body;
      const frame = this.frames.add(`sb:${i}`, this.sunFrame.id, (t, o) => {
        smallBodyPosition(el, t.jdTdb, o);
        o[0] *= AU; o[1] *= AU; o[2] *= AU;
      });
      const radius = ((body.diameterKm ?? 1) * KM) / 2;
      const color = new Color(COLORS[body.kind]);
      color.toArray(colors, i * 3);
      const material = createPlanetMaterial({ color, seed: (i * 53) % 997 });
      const mesh = new Mesh(this.sphere, material);
      mesh.scale.setScalar(radius);
      mesh.visible = false;
      const orbitMaterial = new LineBasicMaterial({ color: color.clone().lerp(new Color('#9aa7ff'), 0.4), transparent: true, opacity: 0.35, depthWrite: false });
      const orbit = new Line(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(ORBIT_SEGMENTS * 3), 3)), orbitMaterial);
      orbit.frustumCulled = false;
      this.object.add(mesh, orbit);
      return {
        body, frame, radius, mesh, material, orbit, orbitMaterial, orbitPoints: this.sampleOrbit(body),
        view: { key: `sb:${i}`, name: body.name, rel: [0, 0, 0], distance: 0, radiusPx: 0, magnitude: 99 },
      };
    });
    pg.setAttribute('color', new BufferAttribute(colors, 3));
    this.points = new Points(pg, this.pointsMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.object.add(this.points);
  }

  /** The whole ellipse for closed orbits; ±25 years around perihelion for open ones. Metres from the Sun. */
  private sampleOrbit(b: SmallBody): Vec3[] {
    const pts: Vec3[] = [];
    const period = smallBodyPeriod(b);
    const span = Number.isFinite(period) ? period : 2 * 25 * 365.25;
    const start = Number.isFinite(period) ? b.tp : b.tp - span / 2;
    for (let k = 0; k < ORBIT_SEGMENTS; k++) {
      // Closed orbits: uniform in eccentric-ish time, denser near perihelion via a cosine warp.
      const u = k / (ORBIT_SEGMENTS - (Number.isFinite(period) ? 0 : 1));
      const w = Number.isFinite(period) ? u : 0.5 - 0.5 * Math.cos(Math.PI * u);
      const p = smallBodyPosition(b, start + span * w);
      pts.push([p[0] * AU, p[1] * AU, p[2] * AU]);
    }
    return pts;
  }

  get views(): SmallBodyView[] {
    return this.renders.map((r) => r.view);
  }

  setPhotometry(magRef: number, magLimit: number): void {
    this.pointsMaterial.uniforms.uMagRef!.value = magRef;
    this.pointsMaterial.uniforms.uMagLimit!.value = magLimit;
  }

  update(ctx: RenderContext, focusKey: string | null): void {
    this.object.visible = this.enabled && this.renders.length > 0;
    if (!this.object.visible || !this.points) return;
    this.invCam.copy(ctx.camera.quaternion).invert();
    ctx.toCamera(this.sunFrame, [0, 0, 0], this.sunRel);
    const pos = this.points.geometry.getAttribute('position') as BufferAttribute;
    const mag = this.points.geometry.getAttribute('mag') as BufferAttribute;
    const vis = this.points.geometry.getAttribute('visible') as BufferAttribute;
    const camFromSun = Math.hypot(...this.sunRel);
    this.renders.forEach((r, i) => {
      const rel = r.view.rel;
      if (ctx.sky) this.apparentRel(ctx.ephemeris, ctx.sky.observer, i, rel);
      else ctx.toCamera(r.frame, [0, 0, 0], rel);
      const d = Math.hypot(rel[0], rel[1], rel[2]);
      r.view.distance = d;
      r.view.radiusPx = Math.asin(Math.min(1, r.radius / Math.max(d, 1))) * ctx.pixelsPerRadian;
      const toSun: Vec3 = [this.sunRel[0] - rel[0], this.sunRel[1] - rel[1], this.sunRel[2] - rel[2]];
      const rs = Math.hypot(...toSun);
      const phase = Math.acos(Math.min(1, Math.max(-1, -(toSun[0] * rel[0] + toSun[1] * rel[1] + toSun[2] * rel[2]) / (rs * d))));
      const b = r.body;
      r.view.magnitude = (b.kind === 'comet' || b.kind === 'interstellar') && b.M1 !== null
        ? cometMagnitude(rs / AU, d / AU, b.M1, b.K1 ?? 10)
        : asteroidMagnitude(rs / AU, d / AU, phase, b);
      pos.setXYZ(i, rel[0], rel[1], rel[2]);
      mag.setX(i, r.view.magnitude);
      vis.setX(i, r.view.radiusPx < 1.2 ? 1 : 0);
      r.mesh.position.set(rel[0], rel[1], rel[2]);
      r.mesh.visible = r.view.radiusPx > 0.4;
      const s = this.v3.set(toSun[0], toSun[1], toSun[2]).normalize().applyQuaternion(this.invCam);
      (r.material.uniforms.sunDirV!.value as Vector3).copy(s);
      // Orbits: only near the inner/outer Solar System scale, and always for the focused body.
      const focus = focusKey === r.view.key;
      const a = (b.a ?? b.q) * AU;
      const ratio = Math.log10(Math.max(camFromSun, d) / a);
      const fade = ctx.sky ? 0 : focus ? 1 : Math.min(Math.max((ratio + 0.3) / 0.6, 0), 1) * Math.min(Math.max(1.8 - ratio, 0), 1) * 0.6;
      r.orbit.visible = this.showOrbits && fade > 0.01;
      if (r.orbit.visible) {
        r.orbitMaterial.opacity = 0.35 * fade;
        const attr = r.orbit.geometry.getAttribute('position') as BufferAttribute;
        const arr = attr.array as Float32Array;
        // Vertices relative to the Sun, placed at the Sun's camera-relative position.
        r.orbitPoints.forEach((p, k) => arr.set(p, k * 3));
        attr.needsUpdate = true;
        r.orbit.position.set(this.sunRel[0], this.sunRel[1], this.sunRel[2]);
      }
    });
    pos.needsUpdate = mag.needsUpdate = vis.needsUpdate = true;
    this.pointsMaterial.uniforms.uPixelRatio!.value = ctx.pixelRatio;
  }

  /** Observer → body apparent vector (light-time and aberration), metres. */
  apparentRel(eph: Ephemeris, obs: ObserverState, i: number, out: Vec3): Vec3 {
    const p = this.apparent(eph, obs, i);
    const m = p.distanceKm * KM;
    out[0] = p.direction[0] * m; out[1] = p.direction[1] * m; out[2] = p.direction[2] * m;
    return out;
  }

  apparent(eph: Ephemeris, obs: ObserverState, i: number) {
    const b = this.renders[i]?.body ?? this.bodies[i]!;
    const sun: Vec3 = [0, 0, 0];
    let tau = 0;
    const P: Vec3 = [0, 0, 0];
    for (let k = 0; k < 2; k++) {
      eph.barycentric('sun', obs.time.jdTdb - tau, sun);
      const h = smallBodyPosition(b, obs.time.jdTdb - tau, this.tmp);
      P[0] = sun[0] + h[0] * (AU / KM) - obs.position[0];
      P[1] = sun[1] + h[1] * (AU / KM) - obs.position[1];
      P[2] = sun[2] + h[2] * (AU / KM) - obs.position[2];
      tau = Math.hypot(...P) / C_KM_PER_DAY;
    }
    return apparentFromVector(obs, P, tau);
  }

  frameOf(key: string): Frame | undefined {
    return this.renders[Number(key.slice(3))]?.frame;
  }

  target(key: string): OrbitTarget | undefined {
    const r = this.renders[Number(key.slice(3))];
    return r ? { id: key, frame: r.frame, radius: r.radius } : undefined;
  }

  viewDistance(key: string): number {
    const r = this.renders[Number(key.slice(3))];
    return Math.max((r?.radius ?? 1000) * 6, 30e3);
  }

  pick(consider: (key: string, rel: Readonly<Vec3>, reachPx: number, bias?: number) => void, magLimit: number): void {
    for (const r of this.renders) {
      if (r.view.magnitude > magLimit + 1 && r.view.radiusPx < 2) continue;
      consider(r.view.key, r.view.rel, Math.max(r.view.radiusPx, 8), -0.02);
    }
  }

  labels(
    project: (rel: Readonly<Vec3>) => [number, number] | null, free: (x: number, y: number) => boolean,
    placed: [number, number][], magLimit: number, focusKey: string | null, hidden: (rel: Readonly<Vec3>) => boolean,
  ): LabelItem[] {
    const out: LabelItem[] = [];
    const views = this.renders.map((r) => r.view).sort((a, b) => a.magnitude - b.magnitude);
    for (const v of views) {
      const focus = v.key === focusKey;
      if (!focus && v.magnitude > magLimit - 1 && v.radiusPx < 3) continue;
      if (hidden(v.rel)) continue;
      const s = project(v.rel);
      if (!s || (!focus && !free(s[0], s[1]))) continue;
      placed.push(s);
      const b = this.renders[Number(v.key.slice(3))]!.body;
      out.push({ key: v.key, text: v.name, kind: 'body', x: s[0], y: s[1], marker: v.radiusPx < 2.5, offset: Math.max(v.radiusPx, 3) + 6, color: COLORS[b.kind] });
    }
    return out;
  }

  /** Positions (km, barycentric-ish: Sun-centred) and facts for the info panel. */
  describe(key: string, eph: Ephemeris, obs: ObserverState) {
    const i = Number(key.slice(3));
    const b = this.bodies[i];
    if (!b) return null;
    const p = this.apparent(eph, obs, i);
    const details: [string, string][] = [];
    if (b.diameterKm) details.push(['Diameter', `${b.diameterKm < 10 ? b.diameterKm.toPrecision(2) : Math.round(b.diameterKm).toLocaleString('en-US')} km${b.extentKm ? ` (${b.extentKm} km)` : ''}`]);
    const period = smallBodyPeriod(b);
    details.push(['Orbit', Number.isFinite(period)
      ? `${(period / 365.25).toPrecision(period > 3650 ? 4 : 3)} years · perihelion ${b.q.toPrecision(3)} AU · e ${b.e.toFixed(3)}`
      : `hyperbolic (e ${b.e.toFixed(2)}): passing through, never to return`]);
    if (b.orbitClass) details.push(['Orbit class', b.orbitClass]);
    if (b.rotationH) details.push(['Rotation', `${b.rotationH.toPrecision(3)} h`]);
    if (b.discovered) details.push(['Discovered', `${b.discovered.slice(0, 4)}${b.discoverer ? ` · ${b.discoverer}` : ''}`]);
    if (b.pha) details.push(['Hazard', 'Potentially hazardous asteroid (close approaches to Earth’s orbit)']);
    return {
      name: b.name, subtitle: KIND_LABEL[b.kind], details, place: p, distanceM: p.distanceKm * KM,
      // Two-body orbits drift from reality away from the element epoch.
      approximate: Math.abs(obs.time.jdTdb - b.epochJd) > 3 * 365.25, body: b,
    };
  }

  /** Catalogue entries with distance and brightness as seen from the observer now. */
  catalogEntries(eph: Ephemeris, obs: ObserverState): CatalogEntry[] {
    return this.bodies.map((b, i) => {
      const p = this.apparent(eph, obs, i);
      const delta = p.distanceKm / (AU / KM);
      const sun: Vec3 = [0, 0, 0];
      eph.barycentric('sun', obs.time.jdTdb, sun);
      const h = smallBodyPosition(b, obs.time.jdTdb);
      const r = Math.hypot(...h);
      const mag = (b.kind === 'comet' || b.kind === 'interstellar') && b.M1 !== null
        ? cometMagnitude(r, delta, b.M1, b.K1 ?? 10)
        : asteroidMagnitude(r, delta, 0.3, b);
      const period = smallBodyPeriod(b);
      const extra: [string, string][] = [['Orbit', Number.isFinite(period) ? `${(period / 365.25).toPrecision(3)} years` : 'hyperbolic (interstellar)']];
      if (b.orbitClass) extra.push(['Orbit class', b.orbitClass]);
      return {
        key: `sb:${i}`, ref: b.name, name: b.name, aliases: [b.fullname, b.des], category: b.kind === 'dwarf-planet' ? 'solar-system' : 'small-body',
        type: KIND_LABEL[b.kind], distanceM: p.distanceKm * KM, radiusM: b.diameterKm ? (b.diameterKm * KM) / 2 : undefined,
        massKg: b.gm ? (b.gm * 1e9) / 6.674e-11 : undefined, magnitude: mag, periodDays: Number.isFinite(period) ? period : undefined,
        raDeg: p.raJ2000 * (180 / Math.PI), decDeg: p.decJ2000 * (180 / Math.PI),
        discovered: b.discovered ? { year: Number(b.discovered.slice(0, 4)), by: b.discoverer ?? 'unknown' } : undefined,
        rank: b.kind === 'dwarf-planet' ? 6 : b.kind === 'comet' ? 14 : 20, approximate: Math.abs(obs.time.jdTdb - b.epochJd) > 3 * 365.25, extra,
      } satisfies CatalogEntry;
    });
  }

  searchEntries(): SearchEntry[] {
    return this.bodies.map((b, i) => ({
      key: `sb:${i}`, ref: b.name, name: b.name, aliases: [b.fullname, b.des, b.fullname.replace(/^\d+\s+/, '')],
      kind: 'small-body' as const, rank: b.kind === 'dwarf-planet' ? 6 : b.kind === 'comet' ? 12 : 18, detail: KIND_LABEL[b.kind],
    }));
  }

  dispose(): void {
    this.disposed = true;
    for (const r of this.renders) {
      r.material.dispose();
      r.orbit.geometry.dispose();
      r.orbitMaterial.dispose();
    }
    this.sphere.dispose();
    this.points?.geometry.dispose();
    this.pointsMaterial.dispose();
  }
}

export const SMALL_BODY_KIND_LABEL = KIND_LABEL;
