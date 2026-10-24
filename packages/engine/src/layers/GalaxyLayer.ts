/**
 * Catalogue galaxies (2MRS + Local Group, ~45k): photometric points when
 * small, oriented procedural impostors once their disc spans a few pixels.
 *
 * The impostor is a quad in the galaxy's real 3D disc plane (from its sky
 * position angle and axis ratio; seeded when unknown). Its surface brightness
 * is the galaxy's total flux spread over its projected area, with a shape
 * picked from its Hubble type: spirals (arms, optional bar, bulge),
 * lenticulars, de Vaucouleurs ellipticals, patchy irregulars.
 */

import { MPC, type Vec3 } from '@simuverse/astro';
import { type GalaxyCatalog, hash01 } from '@simuverse/data';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  Points, ShaderMaterial, Vector3,
} from 'three';
import type { Frame } from '../frames.ts';
import { GALAXY_COLOR_GLSL, GALAXY_POINT_FRAGMENT, GALAXY_POINT_VERTEX, MPC_TO_M } from './galaxyShaders.ts';
import { NOISE_GLSL } from './noise.ts';
import type { Layer, RenderContext } from './types.ts';

const impostorVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 iCenter;   // Mpc from the Sun
attribute vec3 iMajor;
attribute vec3 iMinor;
attribute vec4 iParams;   // radius (Mpc), absMag, T-type, seed
attribute vec2 iExtra;    // axis ratio, "also in the background photograph" flag
uniform vec3 uCamMpc;
uniform float uPxPerRad;
uniform float uMagRef;
uniform float uGain;
uniform float uPhotoWeight;
uniform float uVisibility;
uniform float uFogMpc;
varying vec2 vUv;
varying float vIntensity;
varying float vT;
varying float vSeed;
varying float vRpx;
const float MPC_M = ${MPC_TO_M};
void main() {
  vec3 rel = iCenter - uCamMpc;
  float d = max(length(rel), 1e-9);
  float r = iParams.x;
  float rpx = r / d * uPxPerRad;
  vRpx = rpx;
  vUv = position.xy;
  vT = iParams.z;
  vSeed = iParams.w;
  vec3 viewDir = rel / d;
  vec3 ax1, ax2;
  float area;
  if (iParams.z <= -1.0) {
    // Early types: camera-facing ellipse with the observed flattening.
    vec3 mp = iMajor - viewDir * dot(iMajor, viewDir);
    // A major axis pointing straight at us has no sky projection; any perpendicular will do.
    vec3 m = dot(mp, mp) > 1e-8 ? normalize(mp) : normalize(cross(viewDir, abs(viewDir.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    ax1 = m;
    ax2 = normalize(cross(viewDir, m)) * max(iExtra.x, 0.3);
    area = max(iExtra.x, 0.3);
  } else {
    ax1 = iMajor;
    ax2 = iMinor;
    area = max(abs(dot(cross(iMajor, iMinor), viewDir)), 0.12);
  }
  // Impostors take over from points between 1.5 and 4 px.
  float handover = smoothstep(1.5, 4.0, rpx);
  float appMag = iParams.y + 5.0 * log2(d * 1e5) * 0.30103;
  float flux = pow(10.0, -0.4 * (appMag - uMagRef)) * uGain;
  float areaPx = 3.14159 * rpx * rpx * area;
  // Profiles below integrate to ≈ 0.12π over the unit disc.
  float fog = 1.0 - smoothstep(uFogMpc, 4.0 * uFogMpc, d);
  vIntensity = handover * uVisibility * fog * (1.0 - uPhotoWeight * iExtra.y) * flux / max(0.12 * areaPx, 1.0);
  vec3 p = rel + (ax1 * position.x + ax2 * position.y) * r * 1.25;
  gl_Position = projectionMatrix * viewMatrix * vec4(p * MPC_M, 1.0);
  #include <logdepthbuf_vertex>
  if (handover <= 0.0 || vIntensity <= 1e-5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const impostorFragment = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
varying float vIntensity;
varying float vT;
varying float vSeed;
varying float vRpx;
${NOISE_GLSL}
${GALAXY_COLOR_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  vec2 uv = vUv * 1.25;          // quad spans 1.25 radii
  float r = length(uv);
  if (r > 1.25) discard;
  vec3 bulgeCol = vec3(1.0, 0.82, 0.6);
  vec3 col;
  float I;
  if (vT <= -1.0) {
    // de Vaucouleurs profile (r_e ≈ 0.3 R), lenticulars get a faint disc.
    float re = 0.3;
    I = exp(-7.67 * (pow(max(r / re, 1e-3), 0.25) - 1.0)) * 0.012;
    if (vT > -4.0) I += exp(-r / 0.3) * 0.25;
    col = bulgeCol;
  } else if (vT >= 9.5) {
    // Irregular: clumpy, bluish, with bright knots.
    float n = fbm(vec3(uv * 3.0, vSeed * 17.0), 4);
    I = exp(-r / 0.4) * (0.4 + 1.6 * smoothstep(0.45, 0.8, n));
    col = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.6, 0.75), smoothstep(0.7, 0.85, n));
  } else {
    float th = atan(uv.y, uv.x);
    float pitch = mix(0.18, 0.45, clamp(vT / 9.0, 0.0, 1.0));   // tighter arms in early spirals
    float arms = 0.5 + 0.5 * cos(2.0 * (th - log(max(r, 0.02)) / pitch) + vSeed * 6.28);
    arms = pow(arms, 3.0);
    float clumps = fbm(vec3(uv * 6.0, vSeed * 31.0), 4);
    float disc = exp(-r / 0.28);
    float bulgeScale = mix(0.12, 0.04, clamp(vT / 8.0, 0.0, 1.0));
    float bulge = exp(-r / bulgeScale);
    // Bars in roughly a third of spirals (seeded).
    // (Squares written out: GLSL pow() is undefined for negative bases and yields NaN on some GPUs.)
    vec2 b = uv / vec2(0.32, 0.07);
    float bar = step(0.62, fract(vSeed * 7.13)) * exp(-dot(b, b));
    float armLight = disc * (0.35 + 1.4 * arms * (0.6 + 0.8 * clumps));
    float dust = 1.0 - 0.45 * smoothstep(0.55, 0.95, 0.5 + 0.5 * cos(2.0 * (th - log(max(r, 0.02)) / pitch) + vSeed * 6.28 - 0.5)) * smoothstep(0.08, 0.3, r);
    I = (armLight * dust + bulge * 1.8 + bar * 0.9);
    col = mix(vec3(0.62, 0.74, 1.0), bulgeCol, clamp((bulge * 1.8 + bar) / max(I, 1e-4), 0.0, 1.0));
    // Pink H II knots along the arms.
    col = mix(col, vec3(1.0, 0.45, 0.6), 0.5 * smoothstep(0.78, 0.9, clumps) * arms);
  }
  I *= smoothstep(1.25, 0.9, r);
  gl_FragColor = vec4(col * I * vIntensity, 1.0);
}
`;

export class GalaxyLayer implements Layer {
  readonly object = new Group();
  private readonly impostorMaterial: ShaderMaterial;
  private readonly pointMaterial: ShaderMaterial;
  private readonly tmp: Vec3 = [0, 0, 0];
  /** Camera position relative to the Sun, Mpc (updated each frame). */
  readonly camMpc: Vec3 = [0, 0, 0];
  enabled = true;

  constructor(readonly catalog: GalaxyCatalog, private readonly sunFrame: Frame, inPhotograph: (i: number) => boolean) {
    const n = catalog.count;
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const params = new Float32Array(n * 4);
    const extra = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      params.set([catalog.radiusKpc[i]! / 1000, catalog.absMagV[i]!, catalog.tType[i]!, hash01(i * 3 + 11)], i * 4);
      extra.set([catalog.axisRatio[i]!, inPhotograph(i) ? 1 : 0], i * 2);
    }
    g.setAttribute('iCenter', new InstancedBufferAttribute(catalog.positions, 3));
    g.setAttribute('iMajor', new InstancedBufferAttribute(catalog.major, 3));
    g.setAttribute('iMinor', new InstancedBufferAttribute(catalog.minor, 3));
    g.setAttribute('iParams', new InstancedBufferAttribute(params, 4));
    g.setAttribute('iExtra', new InstancedBufferAttribute(extra, 2));
    g.instanceCount = n;
    this.impostorMaterial = new ShaderMaterial({
      vertexShader: impostorVertex,
      fragmentShader: impostorFragment,
      uniforms: {
        uCamMpc: { value: new Vector3() },
        uPxPerRad: { value: 1000 },
        uMagRef: { value: 5.5 },
        uGain: { value: 1 },
        uPhotoWeight: { value: 0 },
        uVisibility: { value: 1 },
        uFogMpc: { value: 1e9 },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const impostors = new Mesh(g, this.impostorMaterial);
    impostors.frustumCulled = false;
    impostors.renderOrder = -8;

    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(catalog.positions, 3));
    pg.setAttribute('absMag', new BufferAttribute(catalog.absMagV, 1));
    pg.setAttribute('tType', new BufferAttribute(catalog.tType, 1));
    pg.setAttribute('radiusMpc', new BufferAttribute(params.filter((_, k) => k % 4 === 0), 1));
    this.pointMaterial = createGalaxyPointMaterial();
    const points = new Points(pg, this.pointMaterial);
    points.frustumCulled = false;
    points.renderOrder = -9;
    this.object.add(points, impostors);
  }

  /**
   * @param photoWeight how much of the background photograph is showing (it already contains the Magellanic Clouds)
   * @param visibility sky-brightness visibility in Sky mode (1 in space)
   */
  update(ctx: RenderContext, photoWeight = 0, visibility = 1): void {
    this.object.visible = this.enabled;
    const s = ctx.toCamera(this.sunFrame, [0, 0, 0], this.tmp);
    this.camMpc[0] = -s[0] / MPC;
    this.camMpc[1] = -s[1] / MPC;
    this.camMpc[2] = -s[2] / MPC;
    const ui = this.impostorMaterial.uniforms;
    (ui.uCamMpc!.value as Vector3).set(...this.camMpc);
    ui.uPxPerRad!.value = ctx.pixelsPerRadian * ctx.pixelRatio;
    // Resolved galaxies keep the naked-eye reference; only the gentle extended gain applies.
    ui.uMagRef!.value = 5.5;
    ui.uGain!.value = ctx.exposure.extendedGain;
    ui.uPhotoWeight!.value = photoWeight;
    ui.uVisibility!.value = visibility;
    ui.uFogMpc!.value = ctx.exposure.fogMpc;
    const up = this.pointMaterial.uniforms;
    (up.uOriginCamMpc!.value as Vector3).set(...this.camMpc);
    up.uPxPerRad!.value = ctx.pixelsPerRadian * ctx.pixelRatio;
    up.uPixelRatio!.value = ctx.pixelRatio;
    up.uFade!.value = visibility;
    up.uFogMpc!.value = ctx.exposure.fogMpc;
  }

  setPhotometry(magRef: number, magLimit: number): void {
    this.pointMaterial.uniforms.uMagRef!.value = magRef;
    this.pointMaterial.uniforms.uMagLimit!.value = magLimit;
  }

  dispose(): void {
    for (const o of this.object.children) {
      const m = o as Mesh;
      m.geometry.dispose();
      (m.material as ShaderMaterial).dispose();
    }
  }
}

export function createGalaxyPointMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: GALAXY_POINT_VERTEX,
    fragmentShader: GALAXY_POINT_FRAGMENT,
    uniforms: {
      uOriginCamMpc: { value: new Vector3() },
      uPxPerRad: { value: 1000 },
      uFade: { value: 1 },
      uFogMpc: { value: 1e9 },
      uMagRef: { value: 5.5 },
      uMagLimit: { value: 8.5 },
      uPixelRatio: { value: 1 },
      // Small, capped points: at cosmological scales thousands overlap, and big glows turn to fog.
      uMaxSize: { value: 5 },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}
