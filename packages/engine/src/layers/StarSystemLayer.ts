/**
 * Close-up rendering of one star other than the Sun (the "active" star: the
 * one you are travelling to or flying near): a limb-darkened disc with a
 * glow, and for exoplanet hosts the planets, their orbits and the habitable
 * zone. Everything is placed camera-relative from float64 positions, like the
 * solar system. Planet looks are procedural, chosen from size and temperature.
 */

import { AU, PC, type Vec3, apparentMagnitude, blackbodyRgb, type ExoOrbit, exoplanetPosition } from '@simuverse/astro';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, LineBasicMaterial, LineLoop, Matrix4,
  Mesh, MeshBasicMaterial, Points, Quaternion, RingGeometry, type ShaderMaterial, Vector3,
} from 'three';
import type { Frame } from '../frames.ts';
import {
  createBodyGeometry, createBodyPointsMaterial, createPlanetMaterial, createStarMaterial, createSunGlowMaterial,
} from './bodyMaterials.ts';
import type { Layer, RenderContext } from './types.ts';

const ORBIT_SEGMENTS = 256;
/** Below this apparent radius (CSS px) a planet is drawn as a point. */
const POINT_THRESHOLD_PX = 1.2;
const PLANET_ALBEDO = 0.3;

export interface ActivePlanet {
  key: string;
  name: string;
  orbit: ExoOrbit | null;
  radiusM: number;
  color: string;
  banded: boolean;
}

export interface ActiveStar {
  key: string;
  name: string;
  /** Sun → star, metres (ecliptic J2000). */
  positionM: Vec3;
  radiusM: number;
  teff: number;
  absMag: number;
  planets: ActivePlanet[];
  /** Habitable zone, metres, if known. */
  hz: { inner: number; outer: number } | null;
}

export interface SystemBodyView {
  key: string;
  name: string;
  rel: Vec3;
  distance: number;
  radiusPx: number;
  color: string;
  magnitude: number;
}

interface PlanetRender {
  planet: ActivePlanet;
  group: Group;
  mesh: Mesh;
  material: ShaderMaterial;
  orbit: LineLoop | null;
  view: SystemBodyView;
}

export class StarSystemLayer implements Layer {
  readonly object = new Group();
  active: ActiveStar | null = null;
  readonly star: SystemBodyView = { key: '', name: '', rel: [0, 0, 0], distance: 0, radiusPx: 0, color: '#ffffff', magnitude: 99 };
  planets: PlanetRender[] = [];
  showOrbits = true;

  private readonly sphere = createBodyGeometry(96, 48);
  private readonly starMesh: Mesh;
  private readonly starMaterial = createStarMaterial();
  private readonly glow: Points;
  private readonly glowMaterial = createSunGlowMaterial();
  private readonly points: Points;
  private readonly pointsMaterial = createBodyPointsMaterial();
  private readonly systemGroup = new Group();
  private hz: Mesh | null = null;
  private readonly invCam = new Quaternion();
  private readonly v3 = new Vector3();
  private readonly m4 = new Matrix4();
  private readonly tmp: Vec3 = [0, 0, 0];
  private readonly pos: Vec3 = [0, 0, 0];

  constructor(private readonly sunFrame: Frame) {
    this.starMesh = new Mesh(this.sphere, this.starMaterial);
    const gg = new BufferGeometry();
    gg.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    this.glow = new Points(gg, this.glowMaterial);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 5;
    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(new Float32Array(3 * 32), 3));
    pg.setAttribute('mag', new BufferAttribute(new Float32Array(32), 1));
    pg.setAttribute('visible', new BufferAttribute(new Float32Array(32), 1));
    pg.setAttribute('color', new BufferAttribute(new Float32Array(3 * 32), 3));
    this.points = new Points(pg, this.pointsMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.object.add(this.starMesh, this.glow, this.points, this.systemGroup);
    this.object.visible = false;
  }

  setActive(star: ActiveStar | null): void {
    if (star?.key === this.active?.key) return;
    this.clearSystem();
    this.active = star;
    this.object.visible = !!star;
    if (!star) return;
    const [r, g, b] = blackbodyRgb(star.teff);
    const m = Math.max(r, g, b);
    (this.starMaterial.uniforms.uColor!.value as Color).setRGB(r / m, g / m, b / m);
    (this.glowMaterial.uniforms.uTint!.value as Vector3).set(r / m, g / m, b / m);
    this.starMesh.scale.setScalar(star.radiusM);
    this.star.key = star.key;
    this.star.name = star.name;

    const colors = this.points.geometry.getAttribute('color') as BufferAttribute;
    this.planets = star.planets.slice(0, 32).map((planet, k) => {
      const group = new Group();
      const material = createPlanetMaterial({
        color: new Color(planet.color),
        atmoColor: new Color(planet.color).lerp(new Color('#ffffff'), 0.4),
        atmoStrength: planet.banded ? 0.3 : 0.1,
        seed: (k * 37 + star.name.length * 11) % 997,
        banded: planet.banded,
      });
      const mesh = new Mesh(this.sphere, material);
      mesh.scale.setScalar(planet.radiusM);
      group.add(mesh);
      // Orient the planet's procedural bands with its orbit (z = orbit normal).
      if (planet.orbit) {
        const o = planet.orbit;
        this.m4.set(o.p[0], o.q[0], o.normal[0], 0, o.p[1], o.q[1], o.normal[1], 0, o.p[2], o.q[2], o.normal[2], 0, 0, 0, 0, 1);
        group.quaternion.setFromRotationMatrix(this.m4);
      }
      this.systemGroup.add(group);
      let orbit: LineLoop | null = null;
      if (planet.orbit) {
        const geom = new BufferGeometry();
        const arr = new Float32Array(ORBIT_SEGMENTS * 3);
        const o = planet.orbit;
        for (let s = 0; s < ORBIT_SEGMENTS; s++) {
          exoplanetPosition(o, o.epochJd + (o.periodDays * s) / ORBIT_SEGMENTS, this.tmp);
          arr.set(this.tmp, s * 3);
        }
        geom.setAttribute('position', new BufferAttribute(arr, 3));
        orbit = new LineLoop(geom, new LineBasicMaterial({
          color: new Color(planet.color).lerp(new Color('#9aa7ff'), 0.45), transparent: true, opacity: 0.5, depthWrite: false,
        }));
        orbit.frustumCulled = false;
        this.systemGroup.add(orbit);
      }
      new Color(planet.color).toArray(colors.array as Float32Array, k * 3);
      return {
        planet, group, mesh, material, orbit,
        view: { key: planet.key, name: planet.name, rel: [0, 0, 0], distance: 0, radiusPx: 0, color: planet.color, magnitude: 99 },
      };
    });
    colors.needsUpdate = true;

    const plane = star.planets.find((p) => p.orbit)?.orbit;
    if (star.hz && plane) {
      this.hz = new Mesh(
        new RingGeometry(star.hz.inner, star.hz.outer, 160, 1),
        new MeshBasicMaterial({ color: '#2fd18a', transparent: true, opacity: 0.1, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }),
      );
      this.m4.set(plane.p[0], plane.q[0], plane.normal[0], 0, plane.p[1], plane.q[1], plane.normal[1], 0, plane.p[2], plane.q[2], plane.normal[2], 0, 0, 0, 0, 1);
      this.hz.quaternion.setFromRotationMatrix(this.m4);
      this.hz.renderOrder = 3;
      this.systemGroup.add(this.hz);
    }
  }

  private clearSystem(): void {
    for (const p of this.planets) {
      p.material.dispose();
      p.orbit?.geometry.dispose();
      (p.orbit?.material as LineBasicMaterial | undefined)?.dispose();
    }
    this.planets = [];
    if (this.hz) {
      this.hz.geometry.dispose();
      (this.hz.material as MeshBasicMaterial).dispose();
      this.hz = null;
    }
    this.systemGroup.clear();
  }

  setPhotometry(magRef: number, magLimit: number): void {
    for (const m of [this.glowMaterial, this.pointsMaterial]) {
      m.uniforms.uMagRef!.value = magRef;
      m.uniforms.uMagLimit!.value = magLimit;
    }
  }

  update(ctx: RenderContext): void {
    const star = this.active;
    if (!star) return;
    this.invCam.copy(ctx.camera.quaternion).invert();
    const s = ctx.toCamera(this.sunFrame, star.positionM, this.star.rel);
    const d = Math.hypot(s[0], s[1], s[2]);
    this.star.distance = d;
    this.star.radiusPx = Math.asin(Math.min(1, star.radiusM / Math.max(d, 1))) * ctx.pixelsPerRadian;
    this.star.magnitude = apparentMagnitude(star.absMag, d / PC);
    this.starMesh.position.set(s[0], s[1], s[2]);
    this.starMesh.visible = this.star.radiusPx > 0.3;
    this.starMaterial.uniforms.uTime!.value = performance.now() / 1000;
    // Expose for the disc as it fills the view (otherwise bloom turns a close star into a white-out).
    this.starMaterial.uniforms.uIntensity!.value = 14 / (1 + this.star.radiusPx / 12);
    this.glow.position.set(s[0], s[1], s[2]);
    const gu = this.glowMaterial.uniforms;
    gu.uAppMag!.value = this.star.magnitude;
    // A star a few pixels across gets a halo several times its size; close up the halo
    // only rims the disc, or it would wash out the whole view.
    const rpx = this.star.radiusPx;
    gu.uHaloPx!.value = Math.min(rpx * (1 + 7 / (1 + rpx / 10)), 2048);
    gu.uPixelRatio!.value = ctx.pixelRatio;
    this.systemGroup.position.set(s[0], s[1], s[2]);
    this.systemGroup.visible = true;

    const posAttr = this.points.geometry.getAttribute('position') as BufferAttribute;
    const magAttr = this.points.geometry.getAttribute('mag') as BufferAttribute;
    const visAttr = this.points.geometry.getAttribute('visible') as BufferAttribute;
    const jd = ctx.time.jdTdb;
    this.planets.forEach((p, k) => {
      const o = p.planet.orbit;
      if (o) exoplanetPosition(o, jd, this.pos);
      else this.pos[0] = this.pos[1] = this.pos[2] = 0;
      const rel = p.view.rel;
      rel[0] = s[0] + this.pos[0]; rel[1] = s[1] + this.pos[1]; rel[2] = s[2] + this.pos[2];
      const dist = Math.hypot(rel[0], rel[1], rel[2]);
      p.view.distance = dist;
      p.view.radiusPx = Math.asin(Math.min(1, p.planet.radiusM / Math.max(dist, 1))) * ctx.pixelsPerRadian;
      // Reflected starlight: star's absolute magnitude scaled by albedo × (R/r)², at the camera's distance.
      const r = Math.max(Math.hypot(this.pos[0], this.pos[1], this.pos[2]), star.radiusM * 2);
      p.view.magnitude = star.absMag - 2.5 * Math.log10(PLANET_ALBEDO * (p.planet.radiusM / r) ** 2) + 5 * Math.log10(dist / PC / 10);
      p.group.position.set(this.pos[0], this.pos[1], this.pos[2]);
      p.mesh.visible = p.view.radiusPx > POINT_THRESHOLD_PX * 0.3;
      const sun = this.v3.set(-this.pos[0], -this.pos[1], -this.pos[2]).normalize().applyQuaternion(this.invCam);
      (p.material.uniforms.sunDirV!.value as Vector3).copy(sun);
      posAttr.setXYZ(k, rel[0], rel[1], rel[2]);
      magAttr.setX(k, p.view.magnitude);
      visAttr.setX(k, p.view.radiusPx < POINT_THRESHOLD_PX ? 1 : 0);
      if (p.orbit) {
        // Visible from roughly the orbit's own scale; gone when it is a dot or a line through the camera
        // (exoplanet orbits are small, so this cuts in at 1% of the orbit, not the solar system's 0.05%).
        const ratio = Math.log10(dist / (o?.a ?? AU));
        const fade = Math.min(Math.max(ratio + 2, 0), 1) * Math.min(Math.max(3.5 - ratio, 0), 1);
        p.orbit.visible = this.showOrbits && fade > 0.01;
        (p.orbit.material as LineBasicMaterial).opacity = 0.45 * fade;
      }
    });
    for (let k = this.planets.length; k < 32; k++) visAttr.setX(k, 0);
    posAttr.needsUpdate = magAttr.needsUpdate = visAttr.needsUpdate = true;
    this.pointsMaterial.uniforms.uPixelRatio!.value = ctx.pixelRatio;
    if (this.hz) {
      // A map overlay for the whole system: shown only from outside it, never from among the planets
      // (from inside, nearly edge-on, it would sweep across the view).
      const ratio = Math.log10(d / (star.hz?.outer ?? AU));
      const fade = Math.min(Math.max((ratio - 0.15) / 0.35, 0), 1) * Math.min(Math.max(3 - ratio, 0), 1);
      (this.hz.material as MeshBasicMaterial).opacity = 0.07 * fade;
      this.hz.visible = this.showOrbits && fade > 0.01;
    }
  }

  dispose(): void {
    this.clearSystem();
    this.sphere.dispose();
    this.starMaterial.dispose();
    this.glow.geometry.dispose();
    this.glowMaterial.dispose();
    this.points.geometry.dispose();
    this.pointsMaterial.dispose();
  }
}
