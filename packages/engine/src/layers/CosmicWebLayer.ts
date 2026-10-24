/**
 * Procedural large-scale structure beyond the real catalogue (≳ 250 Mpc) out
 * to the edge of the observable universe, streamed as an implicit octree whose
 * nodes are generated in workers. Plus a faint shell marking the comoving
 * horizon (14.25 Gpc). Everything here is approximate and labelled so.
 */

import { MPC, type Vec3 } from '@simuverse/astro';
import {
  OBSERVABLE_RADIUS_MPC, type TileLoader, type WebNodeData, type WebNodeKey, selectWebNodes, webNodeCenter, webNodeId,
} from '@simuverse/data';
import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, DataTexture, Group, LinearFilter, Mesh, Points,
  RepeatWrapping, ShaderMaterial, SphereGeometry, Vector3,
} from 'three';
import type { Frame } from '../frames.ts';
import { createGalaxyPointMaterial } from './GalaxyLayer.ts';
import { fbm } from './noise.ts';
import type { Layer, RenderContext } from './types.ts';

const MAX_IN_FLIGHT = 4;
const EVICT_AFTER_S = 6;
/** The layer only matters once the camera is far from home (its galaxies are > 230 Mpc away). */
const ACTIVE_FROM_MPC = 30;

interface LoadedNode {
  key: WebNodeKey;
  center: Vec3;
  points: Points;
  material: ShaderMaterial;
  lastWanted: number;
}

const horizonFragment = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec2 uv = vec2(atan(d.y, d.x) * 0.15915494 + 0.5, asin(clamp(d.z, -1.0, 1.0)) * 0.31830989 + 0.5);
  gl_FragColor = vec4(texture2D(uMap, uv).rgb * uOpacity, 1.0);
}
`;

/**
 * Stand-in for the cosmic microwave background: a faint, mottled shell
 * (procedural, not Planck data), baked once into an equirectangular map so the
 * full-screen shell costs one texture read per pixel.
 */
function bakeHorizonMap(width = 512, height = 256): DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const lat = ((j + 0.5) / height - 0.5) * Math.PI;
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width - 0.5) * 2 * Math.PI;
      const n = fbm(9 * Math.cos(lat) * Math.cos(lon), 9 * Math.cos(lat) * Math.sin(lon), 9 * Math.sin(lat), 5) - 0.5;
      const w = smooth(-0.18, 0.18, n), g = 0.6 + 0.8 * Math.abs(n);
      const k = (j * width + i) * 4;
      data[k] = 255 * Math.min((0.3 + 0.7 * w) * g, 1);
      data[k + 1] = 255 * Math.min((0.45 + 0.1 * w) * g, 1);
      data[k + 2] = 255 * Math.min((1 - 0.7 * w) * g, 1);
      data[k + 3] = 255;
    }
  }
  const tex = new DataTexture(data, width, height);
  tex.wrapS = RepeatWrapping;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class CosmicWebLayer implements Layer {
  readonly object = new Group();
  private readonly nodes = new Map<string, LoadedNode>();
  private readonly inFlight = new Set<string>();
  private wanted = new Map<string, WebNodeKey>();
  private lastSelect = -Infinity;
  private lastCam: Vec3 = [Infinity, 0, 0];
  private readonly template = createGalaxyPointMaterial();
  private readonly horizon: Mesh;
  private readonly horizonMaterial: ShaderMaterial;
  private readonly tmp: Vec3 = [0, 0, 0];
  enabled = true;
  showHorizon = true;
  /** Galaxy-point magnitude limit (shared with the catalogue layer). */
  magLimit = 8.5;
  /** Most procedural galaxies kept on the GPU at once (set by the quality preset). */
  budget = 400_000;

  constructor(private readonly loader: TileLoader, private readonly sunFrame: Frame) {
    this.horizonMaterial = new ShaderMaterial({
      // The unit normal, not the position: squaring a ~4e26 m position overflows float32 in normalize().
      vertexShader: 'varying vec3 vDir; void main() { vDir = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: horizonFragment,
      uniforms: { uOpacity: { value: 0 }, uMap: { value: null } },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.horizon = new Mesh(new SphereGeometry(OBSERVABLE_RADIUS_MPC * MPC, 96, 48), this.horizonMaterial);
    this.horizon.frustumCulled = false;
    this.horizon.renderOrder = -20;
    this.object.add(this.horizon);
  }

  get loadedGalaxies(): number {
    let n = 0;
    for (const v of this.nodes.values()) n += v.points.geometry.getAttribute('position').count;
    return n;
  }

  setPhotometry(magRef: number, magLimit: number): void {
    this.template.uniforms.uMagRef!.value = magRef;
    this.template.uniforms.uMagLimit!.value = magLimit;
    this.magLimit = magLimit;
  }

  update(ctx: RenderContext): void {
    const s = ctx.toCamera(this.sunFrame, [0, 0, 0], this.tmp);
    const cam: Vec3 = [-s[0] / MPC, -s[1] / MPC, -s[2] / MPC];
    const dist = Math.hypot(...cam);
    const active = this.enabled && !ctx.sky && dist > ACTIVE_FROM_MPC;
    this.object.visible = active;

    // Horizon shell: fades in as the camera zooms out to cosmological scales.
    this.horizon.position.set(s[0], s[1], s[2]);
    const opacity = this.showHorizon ? 0.05 * smooth(500, 8000, dist) : 0;
    this.horizonMaterial.uniforms.uOpacity!.value = opacity;
    // Skip the full-screen shell entirely until it shows (it is invisible below ~500 Mpc).
    this.horizon.visible = opacity > 1e-4;
    if (this.horizon.visible && !this.horizonMaterial.uniforms.uMap!.value) this.horizonMaterial.uniforms.uMap!.value = bakeHorizonMap();
    if (!active) return;

    const now = performance.now() / 1000;
    const moved = Math.hypot(cam[0] - this.lastCam[0], cam[1] - this.lastCam[1], cam[2] - this.lastCam[2]);
    if (moved > Math.max(dist, 10) * 0.05 || now - this.lastSelect > 3) {
      this.lastSelect = now;
      this.lastCam = cam;
      this.wanted = new Map(selectWebNodes(cam, this.magLimit + 0.5, this.budget).map((k) => [webNodeId(k), k]));
    }
    for (const [id, key] of this.wanted) {
      const n = this.nodes.get(id);
      if (n) n.lastWanted = now;
      else if (!this.inFlight.has(id) && this.inFlight.size < MAX_IN_FLIGHT) this.load(id, key);
    }
    for (const [id, n] of this.nodes) if (!this.wanted.has(id) && now - n.lastWanted > EVICT_AFTER_S) this.evict(id);

    const t = this.template.uniforms;
    for (const n of this.nodes.values()) {
      const u = n.material.uniforms;
      (u.uOriginCamMpc!.value as Vector3).set(cam[0] - n.center[0], cam[1] - n.center[1], cam[2] - n.center[2]);
      u.uPxPerRad!.value = ctx.pixelsPerRadian * ctx.pixelRatio;
      u.uPixelRatio!.value = ctx.pixelRatio;
      u.uMagRef!.value = t.uMagRef!.value;
      u.uMagLimit!.value = t.uMagLimit!.value;
      // Fade in across the transition from the real catalogue.
      u.uFade!.value = smooth(ACTIVE_FROM_MPC, ACTIVE_FROM_MPC * 4, dist);
      u.uFogMpc!.value = ctx.exposure.fogMpc;
    }
  }

  private load(id: string, key: WebNodeKey): void {
    this.inFlight.add(id);
    this.loader
      .webNode(key)
      .then((web: WebNodeData) => {
        this.inFlight.delete(id);
        if (!this.wanted.has(id) || web.count === 0) return;
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(web.positions, 3));
        g.setAttribute('absMag', new BufferAttribute(web.absMag, 1));
        // Environment → morphology: clusters red/early, field blue/late.
        const t = new Float32Array(web.count);
        const r = new Float32Array(web.count);
        for (let i = 0; i < web.count; i++) {
          t[i] = web.environment[i] === 0 ? -4 : web.environment[i] === 1 ? 3 : 6;
          r[i] = 0.012 * 10 ** (-0.2 * (web.absMag[i]! + 21));
        }
        g.setAttribute('tType', new BufferAttribute(t, 1));
        g.setAttribute('radiusMpc', new BufferAttribute(r, 1));
        const material = this.template.clone();
        const points = new Points(g, material);
        points.frustumCulled = false;
        points.renderOrder = -9;
        this.object.add(points);
        this.nodes.set(id, { key, center: webNodeCenter(key), points, material, lastWanted: performance.now() / 1000 });
      })
      .catch((err) => {
        this.inFlight.delete(id);
        console.warn('Cosmic web node failed', err);
      });
  }

  private evict(id: string): void {
    const n = this.nodes.get(id);
    if (!n) return;
    this.object.remove(n.points);
    n.points.geometry.dispose();
    n.material.dispose();
    this.nodes.delete(id);
  }

  dispose(): void {
    for (const id of [...this.nodes.keys()]) this.evict(id);
    this.template.dispose();
    this.horizon.geometry.dispose();
    (this.horizonMaterial.uniforms.uMap!.value as DataTexture | null)?.dispose();
    this.horizonMaterial.dispose();
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
