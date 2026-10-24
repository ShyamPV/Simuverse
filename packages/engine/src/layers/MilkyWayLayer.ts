/**
 * The Milky Way, two ways, cross-faded by the camera's distance from the Sun:
 *
 *  - Near the Sun: NASA/GSFC SVS "Deep Star Maps 2020" background — the
 *    diffuse light of the ~1.7 billion Gaia stars fainter than our point
 *    catalogues — on a sky sphere. Real data, valid only from here.
 *  - Farther out: a volumetric model ray-marched in the galactocentric frame
 *    (exponential disc, 27° bar + bulge, logarithmic spiral arms with young
 *    blue stars and H II regions, and a dust layer). Shape parameters are from
 *    the literature; the detail is procedural and labelled approximate.
 */

import {
  ECLIPTIC_TO_EQUATORIAL, KPC, PC, type Vec3, galactocentricFrame, galactocentricToEcliptic,
  mulMat3Vec, transpose,
} from '@simuverse/astro';
import {
  AdditiveBlending, BackSide, BoxGeometry, Group, LinearFilter, Matrix3, Matrix4, Mesh, ShaderMaterial, SphereGeometry,
  type Texture, TextureLoader, Vector3,
} from 'three';
import type { Frame } from '../frames.ts';
import { NOISE_GLSL } from './noise.ts';
import { VOLUME_BLENDING, type VolumePass } from './VolumePass.ts';
import type { Layer, RenderContext } from './types.ts';

/** Model extent (kpc): disc radius and half-thickness of the ray-march box. */
const MODEL_RADIUS_KPC = 22;
const MODEL_HALF_HEIGHT_KPC = 3;
const BACKGROUND_RADIUS = 2e12; // m, behind the star shell

export interface MilkyWayMeta {
  scale: number;
  gamma: number;
}

const backgroundVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const backgroundFragment = /* glsl */ `
uniform sampler2D uMap;
uniform mat3 uToEquatorial;
uniform float uGain;
uniform float uGamma;
uniform float uScale;
uniform float uSky;
uniform vec3 uZenith;
uniform float uExtinction;
varying vec3 vDir;
const float PI = 3.14159265;
void main() {
  vec3 d = normalize(vDir);
  vec3 e = uToEquatorial * d;
  float ra = atan(e.y, e.x);           // −π..π
  float dec = asin(clamp(e.z, -1.0, 1.0));
  // SVS plate carrée: RA = 180° at the left edge, increasing to the left (centre column RA = 0).
  float u = fract(0.5 - ra / (2.0 * PI));
  float v = 0.5 + dec / PI;
  vec3 c = pow(texture2D(uMap, vec2(u, v)).rgb, vec3(uGamma)) / uScale;
  float k = uGain;
  if (uSky > 0.5) {
    float s = max(dot(d, uZenith), 0.0);
    k *= pow(10.0, -0.4 * uExtinction / (s + 0.025 * exp(-11.0 * s)));
  }
  gl_FragColor = vec4(c * k, 1.0);
}
`;

const volumeVertex = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const volumeFragment = /* glsl */ `
uniform vec3 uCam;         // camera in galactocentric kpc
uniform vec3 uHalf;        // box half extents, kpc
uniform float uGain;
uniform int uSteps;
varying vec3 vLocal;
${NOISE_GLSL}
const float PI = 3.14159265;
const float BAR_ANGLE = 0.47;   // 27° from the Sun–centre line
const float PITCH_TAN = 0.213;  // tan(12°)

vec2 boxHit(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-uHalf - ro) * inv, t1 = (uHalf - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

// Spiral-arm strength (0–1) at galactocentric (x, y): two major + two minor log-spiral arms.
float arms(vec2 p, float phase) {
  float R = max(length(p), 0.3);
  float th = atan(p.y, p.x);
  float w = log(R / 4.0) / PITCH_TAN;
  float major = pow(0.5 + 0.5 * cos(2.0 * (th - w) + phase), 6.0);
  float minor = pow(0.5 + 0.5 * cos(2.0 * (th - w) + phase + PI * 0.5), 8.0) * 0.6;
  return (major + minor) * smoothstep(2.5, 4.5, R) * smoothstep(17.0, 12.0, R);
}

void main() {
  vec3 ro = uCam;
  vec3 rd = normalize(vLocal - uCam);
  vec2 t = boxHit(ro, rd);
  float t0 = max(t.x, 0.0), t1 = t.y;
  if (t1 <= t0) discard;
  float ds = (t1 - t0) / float(uSteps);
  float tcur = t0 + ds * ign(gl_FragCoord.xy);
  vec3 L = vec3(0.0);
  float T = 1.0;
  float cb = cos(BAR_ANGLE), sb = sin(BAR_ANGLE);
  for (int i = 0; i < 160; i++) {
    if (i >= uSteps || T < 0.01) break;
    vec3 p = ro + rd * tcur;
    tcur += ds;
    float R = length(p.xy);
    float az = abs(p.z);
    // Bar + bulge (rotated so the near end points towards l > 0).
    vec2 q = vec2(cb * p.x + sb * p.y, -sb * p.x + cb * p.y);
    float bulge = exp(-2.2 * sqrt((q.x / 1.9) * (q.x / 1.9) + (q.y / 0.75) * (q.y / 0.75) + (p.z / 0.55) * (p.z / 0.55)));
    float disc = exp(-R / 2.6) * exp(-az / 0.3);
    // Empty space (far above the disc / beyond its edge): nothing to shade, skip the noise.
    if (disc + bulge < 2e-4) continue;
    float a = arms(p.xy, 0.0);
    float aDust = arms(p.xy, 0.35);
    // Noise only where it shapes something: clumps in and near the arms, H II knots among young stars.
    float clump = (a > 0.02 || aDust > 0.02) && az < 0.6 ? fbm(p * 1.6, 3) : 0.5;
    float young = a * exp(-az / 0.12) * (0.6 + 0.8 * clump) * exp(-R / 6.0);
    float hii = young > 0.02 ? young * smoothstep(0.62, 0.78, fbm(p * 4.0 + 7.0, 2)) : 0.0;
    // Dust follows the arms' inner edges, thin and clumpy.
    float dust = (0.25 + 1.6 * aDust) * exp(-R / 3.4) * exp(-az / 0.09) * (0.5 + clump);
    vec3 emit = bulge * vec3(1.0, 0.82, 0.6) * 5.0
              + disc * vec3(0.95, 0.9, 0.85) * 1.6
              + young * vec3(0.55, 0.7, 1.0) * 2.2
              + hii * vec3(1.0, 0.35, 0.55) * 3.0;
    float kappa = dust * 9.0;
    float st = exp(-kappa * ds);
    L += T * emit * (kappa > 1e-4 ? (1.0 - st) / kappa : ds);
    T *= st;
  }
  gl_FragColor = vec4(L * uGain, T);
}
`;

export class MilkyWayLayer implements Layer {
  readonly object = new Group();
  private readonly background: Mesh;
  private readonly backgroundMaterial: ShaderMaterial;
  private readonly volume: Mesh;
  private readonly volumeMaterial: ShaderMaterial;
  private readonly gcOffsetPc: Vec3;
  private readonly toEcliptic = galactocentricToEcliptic();
  private readonly fromEcliptic = transpose(galactocentricToEcliptic());
  private readonly tmp: Vec3 = [0, 0, 0];
  private texture: Texture | null = null;
  enabled = true;
  /** 0–1: how much the photographic background is in use (other layers avoid double counting with it). */
  backgroundWeight = 1;
  /** Ray-march steps (quality preset). */
  steps = 72;

  constructor(
    dataBaseUrl: string, private readonly sunFrame: Frame, volumes: VolumePass, meta: MilkyWayMeta = { scale: 8, gamma: 2.2 },
  ) {
    this.backgroundMaterial = new ShaderMaterial({
      vertexShader: backgroundVertex,
      fragmentShader: backgroundFragment,
      uniforms: {
        uMap: { value: null },
        uToEquatorial: { value: new Matrix3().set(...ECLIPTIC_TO_EQUATORIAL) },
        uGain: { value: 0 },
        uGamma: { value: meta.gamma },
        uScale: { value: meta.scale },
        uSky: { value: 0 },
        uZenith: { value: new Vector3(0, 0, 1) },
        uExtinction: { value: 0 },
      },
      side: BackSide,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: false, // opaque pass, drawn before planets (like the stars)
    });
    this.background = new Mesh(new SphereGeometry(BACKGROUND_RADIUS, 96, 48), this.backgroundMaterial);
    this.background.frustumCulled = false;
    this.background.renderOrder = -12;
    this.background.visible = false;
    new TextureLoader().load(new URL('milkyway/milkyway-4k.jpg', dataBaseUrl).href, (t) => {
      // Colour space left as NoColorSpace: the shader decodes the stored gamma itself.
      t.minFilter = LinearFilter; // no mipmaps: avoids a seam at the RA wrap
      t.generateMipmaps = false;
      this.texture = t;
      this.backgroundMaterial.uniforms.uMap!.value = t;
    });

    this.volumeMaterial = new ShaderMaterial({
      vertexShader: volumeVertex,
      fragmentShader: volumeFragment,
      uniforms: {
        uCam: { value: new Vector3() },
        uHalf: { value: new Vector3(MODEL_RADIUS_KPC, MODEL_RADIUS_KPC, MODEL_HALF_HEIGHT_KPC) },
        uGain: { value: 0 },
        uSteps: { value: this.steps },
      },
      side: BackSide,
      // (light, transmittance) into the reduced-resolution volume target: the galaxy glows and its dust dims what lies behind.
      ...VOLUME_BLENDING,
    });
    this.volume = new Mesh(
      new BoxGeometry(2 * MODEL_RADIUS_KPC, 2 * MODEL_RADIUS_KPC, 2 * MODEL_HALF_HEIGHT_KPC),
      this.volumeMaterial,
    );
    this.volume.frustumCulled = false;
    this.volume.renderOrder = 30;
    this.volume.matrixAutoUpdate = false;

    // Sun → Galactic Centre, pc, ecliptic.
    const { sunPc } = galactocentricFrame();
    this.gcOffsetPc = mulMat3Vec(this.toEcliptic, [-sunPc[0], -sunPc[1], -sunPc[2]]);
    this.object.add(this.background);
    volumes.scene.add(this.volume);
  }

  /** Decoding parameters of the background image (from milkyway.json). */
  setMeta(meta: MilkyWayMeta): void {
    this.backgroundMaterial.uniforms.uScale!.value = meta.scale;
    this.backgroundMaterial.uniforms.uGamma!.value = meta.gamma;
  }

  /** Galactic Centre position relative to the Sun, pc (ecliptic). */
  get centerOffsetPc(): Readonly<Vec3> {
    return this.gcOffsetPc;
  }

  update(ctx: RenderContext): void {
    const s = ctx.toCamera(this.sunFrame, [0, 0, 0], this.tmp);
    const camFromSunPc = Math.hypot(s[0], s[1], s[2]) / PC;

    // Photographic background: full within 300 pc of the Sun, gone by 2 kpc.
    let bg = 1 - smoothstep(300, 2000, camFromSunPc);
    const u = this.backgroundMaterial.uniforms;
    if (ctx.sky) {
      // Washed out by twilight, moonlight is not modelled, and light pollution (limit mag) hides it.
      bg *= smoothstep(3.5, 6.2, ctx.sky.limitMag);
      u.uSky!.value = 1;
      (u.uZenith!.value as Vector3).set(...ctx.sky.rig.basis.up);
      u.uExtinction!.value = ctx.sky.atmosphere ? 0.2 : 0;
    } else u.uSky!.value = 0;
    this.backgroundWeight = bg;
    u.uGain!.value = 1.4 * bg;
    this.background.visible = this.enabled && bg > 0.002 && !!this.texture;

    // Volumetric model: fades in as the photograph fades out.
    const model = smoothstep(400, 2500, camFromSunPc);
    this.volume.visible = this.enabled && model > 0.002;
    if (!this.volume.visible) return;
    // Camera in galactocentric kpc: camera − GC = −(toCamera(sun) + gcOffset).
    const camRelGcPc: Vec3 = [
      -(s[0] / PC + this.gcOffsetPc[0]), -(s[1] / PC + this.gcOffsetPc[1]), -(s[2] / PC + this.gcOffsetPc[2]),
    ];
    const camGc = mulMat3Vec(this.fromEcliptic, camRelGcPc);
    const v = this.volumeMaterial.uniforms;
    (v.uCam!.value as Vector3).set(camGc[0] / 1000, camGc[1] / 1000, camGc[2] / 1000);
    v.uGain!.value = 0.02 * model * ctx.exposure.extendedGain;
    v.uSteps!.value = this.steps;
    // Model matrix: galactocentric kpc → camera-relative metres.
    const m = this.toEcliptic;
    const k = KPC;
    const gx = s[0] + this.gcOffsetPc[0] * PC, gy = s[1] + this.gcOffsetPc[1] * PC, gz = s[2] + this.gcOffsetPc[2] * PC;
    this.volume.matrix.copy(new Matrix4().set(
      m[0] * k, m[1] * k, m[2] * k, gx,
      m[3] * k, m[4] * k, m[5] * k, gy,
      m[6] * k, m[7] * k, m[8] * k, gz,
      0, 0, 0, 1,
    ));
    this.volume.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    this.background.geometry.dispose();
    this.backgroundMaterial.dispose();
    this.volume.geometry.dispose();
    this.volumeMaterial.dispose();
    this.texture?.dispose();
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
