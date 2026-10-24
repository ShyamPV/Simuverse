/**
 * Earth's sky for Sky mode, after Hillaire (2020) "A Scalable and Production
 * Ready Sky and Atmosphere Rendering Technique", simplified:
 *
 *  1. Each frame a small sky-view LUT (192×108, azimuth × altitude, denser at
 *     the horizon) is filled by ray-marching single Rayleigh + Mie scattering
 *     with ozone absorption, with sun transmittance marched inline.
 *  2. A dome around the camera samples the LUT and adds in-scattered light
 *     over everything drawn before it (stars fade, the Moon pales by day).
 *
 * The cost is independent of screen resolution. Multiple scattering is
 * approximated by a small isotropic term, which keeps twilight from going black too early.
 */

import {
  BackSide, OrthographicCamera, HalfFloatType, LinearFilter, Mesh, PlaneGeometry, RepeatWrapping, Scene, ShaderMaterial,
  SphereGeometry, Vector3, type WebGLRenderer, WebGLRenderTarget, AdditiveBlending, ClampToEdgeWrapping,
} from 'three';
import type { Layer, RenderContext } from './types.ts';

const LUT_W = 192;
const LUT_H = 108;
const DOME_RADIUS = 5e4; // metres: beyond the near plane, in front of everything else

const ATMOSPHERE_GLSL = /* glsl */ `
const float PI = 3.14159265;
const float Rg = 6360.0;       // km
const float Rt = 6460.0;
const vec3 betaR = vec3(5.802, 13.558, 33.1) * 1e-3;   // Rayleigh scattering, 1/km
const float HR = 8.0;
const float betaMs = 3.996e-3;                          // Mie scattering, 1/km
const float betaMe = 4.40e-3;                           // Mie extinction
const float HM = 1.2;
const vec3 betaO = vec3(0.650, 1.881, 0.085) * 1e-3;    // ozone absorption

vec3 extinctionAt(float h) {
  float dR = exp(-h / HR), dM = exp(-h / HM), dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  return betaR * dR + betaMe * dM + betaO * dO;
}

// Distance along rd to the sphere of radius R (far hit), or -1.
float raySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd), c = dot(ro, ro) - R * R, disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b + sqrt(disc);
}
float rayGround(vec3 ro, vec3 rd) {
  float b = dot(ro, rd), c = dot(ro, ro) - Rg * Rg, disc = b * b - c;
  if (disc < 0.0 || b > 0.0) return -1.0;
  return -b - sqrt(disc);
}

vec3 sunTransmittance(vec3 p, vec3 sunDir) {
  if (rayGround(p, sunDir) > 0.0) return vec3(0.0);
  float t = raySphere(p, sunDir, Rt);
  const int N = 8;
  float ds = t / float(N);
  vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 q = p + sunDir * ((float(i) + 0.5) * ds);
    od += extinctionAt(length(q) - Rg) * ds;
  }
  return exp(-od);
}

vec3 skyRadiance(vec3 rd, vec3 sunDir, float hObs) {
  vec3 ro = vec3(0.0, 0.0, Rg + hObs);
  float tTop = raySphere(ro, rd, Rt);
  float tGround = rayGround(ro, rd);
  float tMax = tGround > 0.0 ? tGround : tTop;
  const int N = 32;
  float mu = dot(rd, sunDir);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  const float g = 0.8;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 L = vec3(0.0), T = vec3(1.0);
  // Non-uniform steps: more samples close to the observer.
  float prev = 0.0;
  for (int i = 0; i < N; i++) {
    float t1 = tMax * pow((float(i) + 1.0) / float(N), 2.0);
    float ds = t1 - prev;
    vec3 p = ro + rd * (prev + 0.5 * ds);
    prev = t1;
    float h = length(p) - Rg;
    vec3 ext = extinctionAt(h);
    vec3 scatR = betaR * exp(-h / HR);
    float scatM = betaMs * exp(-h / HM);
    vec3 Ts = sunTransmittance(p, sunDir);
    // Single scattering plus a small isotropic term standing in for multiple scattering.
    vec3 S = (scatR * phaseR + scatM * phaseM) * Ts + (scatR + scatM) * Ts * 0.008;
    vec3 sampleT = exp(-ext * ds);
    L += T * (S - S * sampleT) / max(ext, vec3(1e-6)); // analytic integration over the step
    T *= sampleT;
  }
  return L;
}
`;

const lutFragment = /* glsl */ `
uniform vec3 uSunDir;      // local ENU (x east, y north, z up)
uniform float uHeightKm;
varying vec2 vUv;
${ATMOSPHERE_GLSL}
void main() {
  float az = vUv.x * 2.0 * PI;
  float v = vUv.y * 2.0 - 1.0;
  float alt = sign(v) * v * v * 0.5 * PI;  // dense near the horizon
  vec3 rd = vec3(cos(alt) * sin(az), cos(alt) * cos(az), sin(alt));
  gl_FragColor = vec4(skyRadiance(rd, uSunDir, uHeightKm), 1.0);
}
`;

const domeVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const domeFragment = /* glsl */ `
uniform sampler2D uLut;
uniform vec3 uEast;
uniform vec3 uNorth;
uniform vec3 uUp;
uniform float uIntensity;
varying vec3 vDir;
const float PI = 3.14159265;
void main() {
  vec3 d = normalize(vDir);
  vec3 l = vec3(dot(d, uEast), dot(d, uNorth), dot(d, uUp));
  float az = atan(l.x, l.y);
  if (az < 0.0) az += 2.0 * PI;
  float alt = asin(clamp(l.z, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(alt) * sqrt(abs(alt) / (0.5 * PI));
  vec3 L = texture2D(uLut, vec2(az / (2.0 * PI), v)).rgb * uIntensity;
  gl_FragColor = vec4(L, 1.0);
}
`;

export class AtmosphereLayer implements Layer {
  readonly object: Mesh;
  private readonly lut: WebGLRenderTarget;
  private readonly lutScene = new Scene();
  // Any camera works for a clip-space quad, but it must support updateProjectionMatrix (reversed-Z).
  private readonly lutCamera = new OrthographicCamera();
  private readonly lutMaterial: ShaderMaterial;
  private readonly domeMaterial: ShaderMaterial;
  enabled = true;
  private active = false;

  constructor() {
    this.lut = new WebGLRenderTarget(LUT_W, LUT_H, {
      type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false,
    });
    this.lut.texture.wrapS = RepeatWrapping;
    this.lut.texture.wrapT = ClampToEdgeWrapping;
    this.lutMaterial = new ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: lutFragment,
      uniforms: { uSunDir: { value: new Vector3(0, 0, 1) }, uHeightKm: { value: 0.1 } },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.lutMaterial);
    quad.frustumCulled = false;
    this.lutScene.add(quad);

    this.domeMaterial = new ShaderMaterial({
      vertexShader: domeVertex,
      fragmentShader: domeFragment,
      uniforms: {
        uLut: { value: this.lut.texture },
        uEast: { value: new Vector3(1, 0, 0) },
        uNorth: { value: new Vector3(0, 1, 0) },
        uUp: { value: new Vector3(0, 0, 1) },
        uIntensity: { value: 10 },
      },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.object = new Mesh(new SphereGeometry(DOME_RADIUS, 64, 32), this.domeMaterial);
    this.object.frustumCulled = false;
    this.object.renderOrder = 50;
  }

  update(ctx: RenderContext): void {
    const sky = ctx.sky;
    this.active = !!sky && sky.atmosphere && this.enabled;
    this.object.visible = this.active;
    if (!sky || !this.active) return;
    const { east, north, up } = sky.rig.basis;
    const u = this.domeMaterial.uniforms;
    (u.uEast!.value as Vector3).set(...east);
    (u.uNorth!.value as Vector3).set(...north);
    (u.uUp!.value as Vector3).set(...up);
    (this.lutMaterial.uniforms.uSunDir!.value as Vector3).set(...sky.sunLocal);
    this.lutMaterial.uniforms.uHeightKm!.value = Math.max(sky.rig.location.height / 1000, 0.01);
  }

  /** Renders the LUT; call before the main scene render while in Sky mode. */
  renderLut(renderer: WebGLRenderer): void {
    if (!this.active) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.lut);
    renderer.render(this.lutScene, this.lutCamera);
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.lut.dispose();
    this.lutMaterial.dispose();
    this.domeMaterial.dispose();
    this.object.geometry.dispose();
  }
}
