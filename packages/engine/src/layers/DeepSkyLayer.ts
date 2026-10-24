/**
 * Star clusters, nebulae, planetary nebulae and supernova remnants (OpenNGC +
 * distances from Harris, Cantat-Gaudin and the literature).
 *
 *  - Objects with a distance are billboards at their real 3D position and
 *    physical size; the rest are drawn as sky directions with their angular size.
 *  - Brightness follows the catalogue magnitude spread over the object's area,
 *    shaded by type (emission red/teal, reflection blue, PN rings, SNR shells).
 *  - Approaching a nebula with a known distance swaps its billboard for a
 *    ray-marched volume with the same size, orientation and colours. The
 *    3D structure is procedural and labelled approximate.
 *
 * Star clusters are mostly made of catalogue stars already drawn by the star
 * layers; their billboards are only a faint unresolved glow.
 */

import { DEG, EQUATORIAL_TO_ECLIPTIC, PC, type Vec3, mulMat3Vec, sphericalToCartesian } from '@simuverse/astro';
import { type DeepSkyObject, hash01 } from '@simuverse/data';
import {
  AdditiveBlending, BackSide, BufferAttribute, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  ShaderMaterial, SphereGeometry, Vector3,
} from 'three';
import type { Frame } from '../frames.ts';
import { NOISE_GLSL } from './noise.ts';
import type { Layer, RenderContext } from './types.ts';
import { VOLUME_BLENDING, type VolumePass } from './VolumePass.ts';

/** Shader type codes. */
const TYPE_CODE: Record<string, number> = {
  OCl: 0, '*Ass': 0, Other: 0, GCl: 1, HII: 2, EmN: 2, Neb: 2, 'Cl+N': 2, RfN: 3, PN: 4, SNR: 5, DrkN: 6,
};
/** Typical integrated magnitudes when the catalogue has none. */
const DEFAULT_MAG = [6, 7.5, 7, 8, 10, 9, 99];
const SHELL_PC = 1e5; // "at infinity" for objects without a distance (but inside the galaxy layers)
const MAX_VOLUMES = 3;

const COMMON_GLSL = /* glsl */ `
${NOISE_GLSL}
// Emission-line colours: H-alpha/[N II] red, [O III] teal, reflection blue, starlight gold.
const vec3 HA = vec3(1.0, 0.28, 0.42);
const vec3 OIII = vec3(0.25, 0.85, 0.8);
const vec3 BLUE = vec3(0.45, 0.6, 1.0);
const vec3 GOLD = vec3(1.0, 0.85, 0.6);

// Brightness (≈ unit integral over the unit disc) and colour of a nebula of type t at disc position uv,
// seen with 3D noise coordinate q (so billboard and volume look alike).
vec4 nebula(float t, vec2 uv, vec3 q, float seed) {
  float r = length(uv);
  // Single exit: early returns trip "potentially uninitialized" warnings in ANGLE's HLSL backend.
  vec4 res = vec4(0.0);
  if (t < 0.5) {            // open cluster: faint unresolved glow
    res = vec4(GOLD, exp(-r * r * 4.0) * 0.6);
  } else if (t < 1.5) {     // globular: King-like concentrated glow
    float k = r / 0.12;
    res = vec4(GOLD, 1.6 / (1.0 + k * k) * smoothstep(1.0, 0.6, r));
  } else if (t < 2.5) {     // emission nebula / H II region
    float n = fbm(q * 2.5 + seed * 13.0, 5);
    float d = smoothstep(0.35, 0.75, n) * smoothstep(1.0, 0.3, r);
    res = vec4(mix(HA, OIII, smoothstep(0.35, 0.0, r) * 0.6), d * 1.6);
  } else if (t < 3.5) {     // reflection nebula
    float n = fbm(q * 2.0 + seed * 7.0, 4);
    res = vec4(BLUE, smoothstep(0.3, 0.8, n) * smoothstep(1.0, 0.2, r) * 1.5);
  } else if (t < 4.5) {     // planetary nebula: bright rim, teal inside, red outside
    // Squares written out: pow() with a negative base is undefined in GLSL (NaN on some GPUs).
    float sr = (r - 0.62) / 0.16;
    float shell = exp(-sr * sr);
    float n = 0.7 + 0.6 * fbm(q * 6.0 + seed * 5.0, 3);
    res = vec4(mix(OIII, HA, smoothstep(0.45, 0.8, r)), (shell * 2.2 + 0.3 * smoothstep(0.7, 0.0, r)) * n);
  } else if (t < 5.5) {     // supernova remnant: filamentary shell
    float ridge = 1.0 - abs(2.0 * fbm(q * 5.0 + seed * 3.0, 4) - 1.0);
    float sr = (r - 0.85) / 0.12;
    float shell = exp(-sr * sr);
    vec3 c = mix(HA, OIII, smoothstep(0.4, 0.9, ridge) * 0.5);
    res = vec4(c, shell * pow(ridge, 4.0) * 4.0 + 0.15 * smoothstep(1.0, 0.0, r) * pow(ridge, 6.0));
  }
  return res;
}
`;

const billboardVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 iPos;      // pc from the Sun (ecliptic); a unit direction when iParams.w < 0
attribute vec4 iParams;   // radius (pc, or radians if no distance), type, magnitude from Earth, ±distance from Earth (pc)
attribute vec2 iShape;    // axis ratio, seed
uniform vec3 uCamPc;
uniform float uPxPerRad;
uniform float uMagRef;
uniform float uGain;
uniform float uVisibility;
uniform float uSuppressId;
uniform float uDirectionOnly;   // visibility of objects known only by direction (0 far from home)
varying vec2 vUv;
varying float vIntensity;
varying float vType;
varying float vSeed;
const float PC_M = 3.0856775814913673e16;
void main() {
  bool hasDist = iParams.w > 0.0;
  vec3 rel;
  float radius, d;
  if (hasDist) {
    rel = iPos - uCamPc;
    d = max(length(rel), 1e-6);
    radius = iParams.x;
  } else {
    rel = iPos * ${SHELL_PC.toExponential()};
    d = ${SHELL_PC.toExponential()};
    radius = iParams.x * d;
  }
  float rpx = radius / d * uPxPerRad;
  // Apparent magnitude scales with distance for objects we can fly to.
  float mag = iParams.z + (hasDist ? 5.0 * log2(d / iParams.w) * 0.30103 : 0.0);
  float flux = pow(10.0, -0.4 * (mag - uMagRef)) * uGain;
  float area = 3.14159 * max(rpx * rpx * iShape.x, 4.0);
  // Billboards hand over to ray-marched volumes for the closest few (suppressed by id).
  float handover = (float(gl_InstanceID) == uSuppressId ? 0.0 : 1.0) * (hasDist ? 1.0 : uDirectionOnly);
  vIntensity = uVisibility * handover * flux / area;
  vUv = position.xy;
  vType = iParams.y;
  vSeed = iShape.y;
  vec3 view = rel / d;
  vec3 up = abs(view.z) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 ax1 = normalize(cross(up, view));
  vec3 ax2 = cross(view, ax1);
  float a = iShape.y * 6.2832;
  vec3 e1 = cos(a) * ax1 + sin(a) * ax2, e2 = (-sin(a) * ax1 + cos(a) * ax2) * iShape.x;
  vec3 p = rel + (e1 * position.x + e2 * position.y) * radius;
  gl_Position = projectionMatrix * viewMatrix * vec4(p * PC_M, 1.0);
  #include <logdepthbuf_vertex>
  if (vIntensity < 1e-5 || vType > 5.5 || rpx < 0.7) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const billboardFragment = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
varying float vIntensity;
varying float vType;
varying float vSeed;
${COMMON_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  if (length(vUv) > 1.0) discard;
  vec4 n = nebula(vType, vUv, vec3(vUv * 1.3, vSeed * 10.0), vSeed);
  gl_FragColor = vec4(n.rgb * n.a * vIntensity, 1.0);
}
`;

const volumeFragment = /* glsl */ `
uniform vec3 uCamLocal;   // camera in the nebula's unit-sphere frame
uniform float uType;
uniform float uSeed;
uniform float uGain;
varying vec3 vLocal;
${COMMON_GLSL}
void main() {
  vec3 rd = normalize(vLocal - uCamLocal);
  float b = dot(uCamLocal, rd), c = dot(uCamLocal, uCamLocal) - 1.0, disc = b * b - c;
  if (disc <= 0.0) discard;
  float t0 = max(-b - sqrt(disc), 0.0), t1 = -b + sqrt(disc);
  const int N = 64;
  float ds = (t1 - t0) / float(N);
  float t = t0 + ds * ign(gl_FragCoord.xy);
  vec3 L = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = uCamLocal + rd * t;
    t += ds;
    float r = length(p);
    // Treat each spherical shell as the billboard's radial profile, with 3D noise for structure.
    vec4 n = nebula(uType, vec2(r, 0.0), p * 1.3, uSeed);
    L += n.rgb * n.a * ds;
  }
  gl_FragColor = vec4(L * uGain, 1.0);
}
`;

interface ActiveVolume {
  index: number;
  mesh: Mesh;
  material: ShaderMaterial;
}

export class DeepSkyLayer implements Layer {
  readonly object = new Group();
  private readonly material: ShaderMaterial;
  /** Per object: Sun-relative position (pc, ecliptic) or null if only the direction is known. */
  readonly positionsPc: (Vec3 | null)[];
  readonly directions: Vec3[];
  readonly radiusPc: number[];
  private readonly volumes: ActiveVolume[] = [];
  private readonly tmp: Vec3 = [0, 0, 0];
  readonly camPc: Vec3 = [0, 0, 0];
  enabled = true;

  constructor(readonly objects: DeepSkyObject[], private readonly sunFrame: Frame, private readonly volumePass: VolumePass) {
    const n = objects.length;
    const pos = new Float32Array(n * 3), params = new Float32Array(n * 4), shape = new Float32Array(n * 2);
    this.positionsPc = [];
    this.directions = [];
    this.radiusPc = [];
    objects.forEach((o, i) => {
      const dir = mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, sphericalToCartesian(o.ra * DEG, o.dec * DEG));
      this.directions.push(dir);
      const type = TYPE_CODE[o.type] ?? 0;
      const angRadius = ((o.majAx ?? 1) / 2) * (DEG / 60);
      const q = o.majAx && o.minAx ? Math.min(Math.max(o.minAx / o.majAx, 0.2), 1) : 1;
      const mag = o.mag ?? DEFAULT_MAG[type]!;
      if (o.distPc) {
        const p: Vec3 = [dir[0] * o.distPc, dir[1] * o.distPc, dir[2] * o.distPc];
        this.positionsPc.push(p);
        this.radiusPc.push(angRadius * o.distPc);
        pos.set(p, i * 3);
        params.set([angRadius * o.distPc, type, mag, o.distPc], i * 4);
      } else {
        this.positionsPc.push(null);
        this.radiusPc.push(0);
        pos.set(dir, i * 3);
        params.set([angRadius, type, mag, -1], i * 4);
      }
      shape.set([q, hash01(i * 17 + 3)], i * 2);
    });
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('iPos', new InstancedBufferAttribute(pos, 3));
    g.setAttribute('iParams', new InstancedBufferAttribute(params, 4));
    g.setAttribute('iShape', new InstancedBufferAttribute(shape, 2));
    g.instanceCount = n;
    this.material = new ShaderMaterial({
      vertexShader: billboardVertex,
      fragmentShader: billboardFragment,
      uniforms: {
        uCamPc: { value: new Vector3() },
        uPxPerRad: { value: 1000 },
        uMagRef: { value: 5.5 },
        uGain: { value: 1 },
        uVisibility: { value: 1 },
        uSuppressId: { value: -1 },
        uDirectionOnly: { value: 1 },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new Mesh(g, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -7;
    this.object.add(mesh);
  }

  update(ctx: RenderContext, magRef = 5.5, visibility = 1): void {
    this.object.visible = this.enabled;
    const s = ctx.toCamera(this.sunFrame, [0, 0, 0], this.tmp);
    this.camPc[0] = -s[0] / PC;
    this.camPc[1] = -s[1] / PC;
    this.camPc[2] = -s[2] / PC;
    const u = this.material.uniforms;
    (u.uCamPc!.value as Vector3).set(...this.camPc);
    u.uPxPerRad!.value = ctx.pixelsPerRadian * ctx.pixelRatio;
    u.uMagRef!.value = magRef;
    u.uGain!.value = ctx.exposure.extendedGain * 0.35;
    u.uVisibility!.value = visibility;
    // Direction-only objects are drawn "at infinity": meaningful only near home.
    const fromSunPc = Math.hypot(...this.camPc);
    u.uDirectionOnly!.value = 1 - Math.min(Math.max((fromSunPc - 200) / 800, 0), 1);
    this.updateVolumes(ctx, s);
  }

  /** Ray-marched volumes for the nebulae the camera is closest to (relative to their size). */
  private updateVolumes(ctx: RenderContext, sunRel: Vec3): void {
    const candidates: { i: number; ratio: number }[] = [];
    this.positionsPc.forEach((p, i) => {
      const t = TYPE_CODE[this.objects[i]!.type] ?? 0;
      if (!p || t < 2 || t > 5) return;
      const d = Math.hypot(p[0] - this.camPc[0], p[1] - this.camPc[1], p[2] - this.camPc[2]);
      const ratio = d / Math.max(this.radiusPc[i]!, 1e-6);
      if (ratio < 12) candidates.push({ i, ratio });
    });
    candidates.sort((a, b) => a.ratio - b.ratio);
    const keep = new Set(candidates.slice(0, MAX_VOLUMES).map((c) => c.i));
    for (let k = this.volumes.length - 1; k >= 0; k--) {
      const v = this.volumes[k]!;
      if (!keep.has(v.index)) {
        this.volumePass.scene.remove(v.mesh);
        v.mesh.geometry.dispose();
        v.material.dispose();
        this.volumes.splice(k, 1);
      }
    }
    for (const i of keep) if (!this.volumes.some((v) => v.index === i)) this.volumes.push(this.createVolume(i));
    // The billboard of the closest volume is suppressed to avoid double light.
    this.material.uniforms.uSuppressId!.value = this.volumes[0]?.index ?? -1;
    for (const v of this.volumes) {
      const p = this.positionsPc[v.index]!;
      const r = this.radiusPc[v.index]!;
      const rel: Vec3 = [(p[0] - this.camPc[0]) * PC, (p[1] - this.camPc[1]) * PC, (p[2] - this.camPc[2]) * PC];
      v.mesh.position.set(...rel);
      v.mesh.scale.setScalar(r * PC);
      (v.material.uniforms.uCamLocal!.value as Vector3).set(-rel[0] / (r * PC), -rel[1] / (r * PC), -rel[2] / (r * PC));
      v.material.uniforms.uGain!.value = 0.25 * ctx.exposure.extendedGain;
    }
  }

  private createVolume(i: number): ActiveVolume {
    const o = this.objects[i]!;
    const material = new ShaderMaterial({
      vertexShader: 'varying vec3 vLocal; void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: volumeFragment,
      uniforms: {
        uCamLocal: { value: new Vector3() },
        uType: { value: TYPE_CODE[o.type] ?? 2 },
        uSeed: { value: hash01(i * 17 + 3) },
        uGain: { value: 1 },
      },
      side: BackSide,
      // Emission only (alpha 1 = no extinction), drawn at reduced resolution with the other volumes.
      ...VOLUME_BLENDING,
    });
    const mesh = new Mesh(new SphereGeometry(1, 48, 24), material);
    mesh.frustumCulled = false;
    this.volumePass.scene.add(mesh);
    return { index: i, mesh, material };
  }

  /** Camera-relative position of object i in metres (3D if distance known, else on the far shell). */
  relativeMetres(i: number, out: Vec3): Vec3 {
    const p = this.positionsPc[i];
    if (p) {
      out[0] = (p[0] - this.camPc[0]) * PC;
      out[1] = (p[1] - this.camPc[1]) * PC;
      out[2] = (p[2] - this.camPc[2]) * PC;
    } else {
      const d = this.directions[i]!;
      out[0] = d[0] * 1e20;
      out[1] = d[1] * 1e20;
      out[2] = d[2] * 1e20;
    }
    return out;
  }

  dispose(): void {
    for (const v of this.volumes) {
      v.mesh.geometry.dispose();
      v.material.dispose();
    }
    const mesh = this.object.children[0] as Mesh;
    mesh.geometry.dispose();
    this.material.dispose();
  }
}
