/**
 * Sun, planets, Moon, rings and orbit lines. Every object is re-positioned
 * each frame at its float64 camera-relative offset; nothing is ever placed at
 * an absolute heliocentric coordinate on the GPU. Orbit-line vertices are
 * likewise rewritten relative to their body so they stay exact up close.
 */

import {
  AU, type Mat3, type PlanetId, PLANET_IDS, PC, type Vec3, apparentMagnitude, centuriesSinceJ2000,
  moonGeocentricEcliptic, planetElements, planetPeriodDays, sampleOrbit, type AstroTime,
} from '@simuverse/astro';
import {
  BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineLoop, Matrix4, Mesh,
  Points, Quaternion, RingGeometry, SRGBColorSpace, type ShaderMaterial,
  type Texture, TextureLoader, Vector3,
} from 'three';
import type { BodyState, SolarSystemModel } from '../SolarSystemModel.ts';
import {
  createBodyGeometry, createPlanetMaterial, createRingMaterial, createSunGlowMaterial, createSunMaterial,
} from './bodyMaterials.ts';
import type { Layer, RenderContext } from './types.ts';

const SUN_ABS_MAG = 4.83;
const ORBIT_SEGMENTS = 256;
const MOON_SIDEREAL_MONTH_DAYS = 27.321661;

const TEXTURES: Record<string, { map: string; night?: string; clouds?: string; rings?: string }> = {
  sun: { map: '2k_sun.jpg' },
  mercury: { map: '2k_mercury.jpg' },
  venus: { map: '2k_venus_atmosphere.jpg' },
  earth: { map: '2k_earth_daymap.jpg', night: '2k_earth_nightmap.jpg', clouds: '2k_earth_clouds.jpg' },
  moon: { map: '2k_moon.jpg' },
  mars: { map: '2k_mars.jpg' },
  jupiter: { map: '2k_jupiter.jpg' },
  saturn: { map: '2k_saturn.jpg', rings: '2k_saturn_ring_alpha.png' },
  uranus: { map: '2k_uranus.jpg' },
  neptune: { map: '2k_neptune.jpg' },
};

const ATMOSPHERES: Record<string, [string, number]> = {
  earth: ['#5b9cff', 1.1],
  venus: ['#f2d9a0', 0.8],
  mars: ['#e0a070', 0.35],
  jupiter: ['#e8d2b0', 0.25],
  saturn: ['#efe0b8', 0.25],
  uranus: ['#a8e4f0', 0.45],
  neptune: ['#6a8cff', 0.45],
};

/** Per-frame screen-space info used by labels, picking and the HUD. */
export interface BodyView {
  id: string;
  name: string;
  /** Camera → body centre, metres. */
  rel: Vec3;
  distance: number;
  /** Apparent radius in CSS pixels. */
  radiusPx: number;
}

interface OrbitTrack {
  line: LineLoop;
  material: LineBasicMaterial;
  /** Sampled orbit points in the parent frame, metres (float64). */
  points: Vec3[];
  sampledAtJd: number;
  resampleDays: number;
  semiMajor: number;
}

interface BodyRender {
  state: BodyState;
  group: Group;
  mesh: Mesh;
  material: ShaderMaterial;
  clouds?: Mesh;
  rings?: Mesh;
  orbit?: OrbitTrack;
  view: BodyView;
}

export class SolarSystemLayer implements Layer {
  readonly object = new Group();
  readonly views: BodyView[] = [];
  private readonly bodies: BodyRender[] = [];
  private readonly sunGlow: Points;
  private readonly sunGlowMaterial: ShaderMaterial;
  private readonly loader = new TextureLoader();
  private readonly textures: Texture[] = [];
  private showOrbits = true;

  private readonly v3 = new Vector3();
  private readonly invCam = new Quaternion();
  private readonly m4 = new Matrix4();
  private readonly tmp: Vec3 = [0, 0, 0];
  private readonly sunRel: Vec3 = [0, 0, 0];

  constructor(private readonly model: SolarSystemModel, textureBaseUrl: string, private readonly maxAnisotropy: number) {
    const sphere = createBodyGeometry();
    for (const state of model.bodies.values()) {
      const id = state.info.id;
      const tex = TEXTURES[id];
      const color = new Color(state.info.color);
      const map = tex ? this.load(textureBaseUrl + tex.map) : undefined;
      let material: ShaderMaterial;
      if (id === 'sun') material = createSunMaterial(map!);
      else {
        const atmo = ATMOSPHERES[id];
        material = createPlanetMaterial({
          map,
          nightMap: tex?.night ? this.load(textureBaseUrl + tex.night) : undefined,
          color,
          atmoColor: atmo ? new Color(atmo[0]) : undefined,
          atmoStrength: atmo?.[1],
        });
      }
      const group = new Group();
      const mesh = new Mesh(sphere, material);
      mesh.scale.set(state.info.radius, state.info.radius, state.info.polarRadius);
      group.add(mesh);
      const render: BodyRender = {
        state, group, mesh, material,
        view: { id, name: state.info.name, rel: [0, 0, 0], distance: 0, radiusPx: 0 },
      };

      if (tex?.clouds) {
        const clouds = new Mesh(sphere, createPlanetMaterial({ map: this.load(textureBaseUrl + tex.clouds), color, clouds: true }));
        clouds.scale.set(state.info.radius * 1.006, state.info.radius * 1.006, state.info.polarRadius * 1.006);
        clouds.renderOrder = 1;
        group.add(clouds);
        render.clouds = clouds;
      }
      if (tex?.rings && state.info.rings) {
        const { inner, outer } = state.info.rings;
        const rings = new Mesh(
          new RingGeometry(inner, outer, 256, 1),
          createRingMaterial(this.load(textureBaseUrl + tex.rings), inner, outer),
        );
        rings.renderOrder = 2;
        group.add(rings);
        render.rings = rings;
      }
      if (id !== 'sun') render.orbit = this.createOrbit(color);

      this.object.add(group);
      this.bodies.push(render);
      this.views.push(render.view);
    }

    this.sunGlowMaterial = createSunGlowMaterial();
    const glowGeom = new BufferGeometry();
    glowGeom.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    this.sunGlow = new Points(glowGeom, this.sunGlowMaterial);
    this.sunGlow.frustumCulled = false;
    this.sunGlow.renderOrder = 5;
    this.object.add(this.sunGlow);
  }

  private load(url: string): Texture {
    const t = this.loader.load(url);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = this.maxAnisotropy;
    this.textures.push(t);
    return t;
  }

  private createOrbit(color: Color): OrbitTrack {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(ORBIT_SEGMENTS * 3), 3));
    const material = new LineBasicMaterial({
      color: color.clone().lerp(new Color('#9aa7ff'), 0.35),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const line = new LineLoop(geom, material);
    line.frustumCulled = false;
    this.object.add(line);
    return { line, material, points: [], sampledAtJd: Number.NaN, resampleDays: 1, semiMajor: 1 };
  }

  setOrbitsVisible(v: boolean): void {
    this.showOrbits = v;
  }

  getView(id: string): BodyView | undefined {
    return this.views.find((v) => v.id === id);
  }

  update(ctx: RenderContext): void {
    this.invCam.copy(ctx.camera.quaternion).invert();
    const sun = this.model.get('sun')!;
    ctx.toCamera(sun.frame, [0, 0, 0], this.sunRel);
    // Close to a body, other planets' orbits project as streaks across the sky
    // (we look along the ecliptic), so they fade in only beyond ~0.02 AU.
    const focusId = ctx.rig.target.id;
    const othersFade = Math.min(Math.max((Math.log10(ctx.rig.distance) - 8) / 1.5, 0), 1);

    for (const b of this.bodies) {
      const rel = ctx.toCamera(b.state.frame, [0, 0, 0], b.view.rel);
      const d = Math.hypot(rel[0], rel[1], rel[2]);
      b.view.distance = d;
      b.view.radiusPx = Math.asin(Math.min(1, b.state.info.radius / Math.max(d, 1))) * ctx.pixelsPerRadian;
      b.group.position.set(rel[0], rel[1], rel[2]);
      this.setOrientation(b.group, b.state.orientation);
      // Bodies below a pixel are represented by markers/labels instead.
      b.group.visible = b.view.radiusPx > 0.35 || b.state.info.id === 'sun';

      if (b.state.info.id !== 'sun') this.updateLighting(b);
      if (b.orbit) {
        const local = b.state.info.id === focusId || b.state.info.parent === focusId;
        this.updateOrbit(b, ctx.time, d, local ? 1 : othersFade);
      }
    }
    this.updateSunGlow(ctx);
  }

  private setOrientation(obj: Group, m: Mat3): void {
    this.m4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
    obj.quaternion.setFromRotationMatrix(this.m4);
  }

  private updateLighting(b: BodyRender): void {
    // Direction body → Sun in view space.
    const r = b.view.rel;
    const s = this.v3.set(this.sunRel[0] - r[0], this.sunRel[1] - r[1], this.sunRel[2] - r[2]).normalize();
    s.applyQuaternion(this.invCam);
    (b.material.uniforms.sunDirV!.value as Vector3).copy(s);
    if (b.clouds) ((b.clouds.material as ShaderMaterial).uniforms.sunDirV!.value as Vector3).copy(s);
    if (b.rings) {
      const u = (b.rings.material as ShaderMaterial).uniforms;
      (u.sunDirV!.value as Vector3).copy(s);
      // Planet centre in view space (camera at origin).
      (u.planetCenterV!.value as Vector3).set(r[0], r[1], r[2]).applyQuaternion(this.invCam);
      u.planetRadius!.value = b.state.info.radius;
      const m = b.state.orientation;
      (u.ringNormalV!.value as Vector3).set(m[2], m[5], m[8]).applyQuaternion(this.invCam);
    }
  }

  private updateOrbit(b: BodyRender, t: AstroTime, camDist: number, contextFade: number): void {
    const o = b.orbit!;
    const id = b.state.info.id;
    if (!(Math.abs(t.jdTdb - o.sampledAtJd) < o.resampleDays)) {
      o.sampledAtJd = t.jdTdb;
      if (id === 'moon') {
        o.points = [];
        for (let k = 0; k < ORBIT_SEGMENTS; k++) {
          const T = centuriesSinceJ2000(t.jdTdb + (MOON_SIDEREAL_MONTH_DAYS * k) / ORBIT_SEGMENTS);
          const p = moonGeocentricEcliptic(T);
          o.points.push([p[0] * AU, p[1] * AU, p[2] * AU]);
        }
        o.resampleDays = MOON_SIDEREAL_MONTH_DAYS / 200;
        o.semiMajor = 384_400e3;
      } else if ((PLANET_IDS as readonly string[]).includes(id)) {
        const el = planetElements(id as PlanetId, centuriesSinceJ2000(t.jdTdb));
        o.points = sampleOrbit(el, ORBIT_SEGMENTS).map((p) => [p[0] * AU, p[1] * AU, p[2] * AU] as Vec3);
        o.resampleDays = planetPeriodDays(id as PlanetId) / 400;
        o.semiMajor = el.a * AU;
      }
    }

    // Fade out when very close to the body (orbit is a straight line through it)
    // or so far away that the orbit is a dot.
    const ratio = Math.log10(camDist / o.semiMajor);
    const fade =
      Math.min(Math.max((ratio + 3.3) / 1.3, 0), 1) * Math.min(Math.max(4 - ratio, 0), 1) * contextFade;
    o.material.opacity = 0.45 * fade;
    o.line.visible = this.showOrbits && fade > 0.01;
    if (!o.line.visible) return;

    // Vertices relative to the body's current position (body frame origin in its parent).
    const origin = b.state.frame.origin;
    const attr = o.line.geometry.getAttribute('position') as BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let k = 0; k < o.points.length; k++) {
      const p = o.points[k]!;
      arr[k * 3] = p[0] - origin[0];
      arr[k * 3 + 1] = p[1] - origin[1];
      arr[k * 3 + 2] = p[2] - origin[2];
    }
    attr.needsUpdate = true;
    o.line.position.copy(b.group.position);
  }

  private updateSunGlow(ctx: RenderContext): void {
    const r = this.sunRel;
    const d = Math.hypot(r[0], r[1], r[2]);
    this.sunGlow.position.set(r[0], r[1], r[2]);
    const u = this.sunGlowMaterial.uniforms;
    u.uAppMag!.value = apparentMagnitude(SUN_ABS_MAG, d / PC);
    const sunPx = Math.asin(Math.min(1, 695_700e3 / d)) * ctx.pixelsPerRadian;
    u.uHaloPx!.value = Math.min(sunPx * 8, 2048);
    u.uPixelRatio!.value = ctx.pixelRatio;
  }

  /** Copies star photometry so the Sun-as-a-star matches catalogue stars. */
  setPhotometry(magRef: number, magLimit: number): void {
    this.sunGlowMaterial.uniforms.uMagRef!.value = magRef;
    this.sunGlowMaterial.uniforms.uMagLimit!.value = magLimit;
  }

  dispose(): void {
    for (const b of this.bodies) {
      b.material.dispose();
      (b.clouds?.material as ShaderMaterial | undefined)?.dispose();
      b.rings?.geometry.dispose();
      (b.rings?.material as ShaderMaterial | undefined)?.dispose();
      b.orbit?.line.geometry.dispose();
      b.orbit?.material.dispose();
    }
    this.bodies[0]?.mesh.geometry.dispose();
    this.sunGlow.geometry.dispose();
    this.sunGlowMaterial.dispose();
    for (const t of this.textures) t.dispose();
  }
}
