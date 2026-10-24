/**
 * Star clusters, nebulae, planetary nebulae and supernova remnants (OpenNGC +
 * distances from Harris, Cantat-Gaudin, Gaia central stars and the literature).
 *
 *  - Objects with a distance are billboards at their real 3D position and
 *    physical size; the rest are drawn as sky directions with their angular size.
 *  - About 250 nebulae have survey images (tools/build-images.mjs): their
 *    billboards show that image, oriented and scaled as on the sky (north up,
 *    east left, seen from Earth). The others are shaded by type (emission
 *    red/teal, reflection blue, PN rings, SNR shells), oriented by their
 *    catalogued position angle.
 *  - Brightness follows the catalogue magnitude spread over the object's area.
 *  - Approaching a nebula swaps its billboard for a ray-marched volume. With an
 *    image, the volume is the image extruded through depth (a lens for clouds, a
 *    shell for planetary nebulae and remnants) so that, seen from Earth, it
 *    integrates back to the image; seen from elsewhere the 3D form is an
 *    estimate, labelled approximate.
 *
 * Star clusters are mostly made of catalogue stars already drawn by the star
 * layers; their billboards are only a faint unresolved glow.
 */

import { DEG, EQUATORIAL_TO_ECLIPTIC, PC, type Vec3, mulMat3Vec, sphericalToCartesian } from '@simuverse/astro';
import { type DeepSkyObject, type ImageIndex, type ObjectImage, hash01 } from '@simuverse/data';
import {
  AdditiveBlending, BackSide, BufferAttribute, Group, InstancedBufferAttribute, InstancedBufferGeometry, Matrix4, Mesh,
  SRGBColorSpace, ShaderMaterial, SphereGeometry, type Texture, TextureLoader, Vector3, Vector4,
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
/** Image volumes are extruded to this depth, as a fraction of their width. */
const IMAGE_DEPTH = 0.45;
const CELESTIAL_NORTH = mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, [0, 0, 1]);

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
attribute vec3 iShape;    // axis ratio, seed, position angle (rad; < −10 if unknown)
attribute vec4 iImage;    // atlas slot (−1 = none), half field of view (rad), mean linear brightness, unused
uniform vec3 uCamPc;
uniform float uPxPerRad;
uniform float uMagRef;
uniform float uGain;
uniform float uVisibility;
uniform vec4 uSuppress;          // up to four instance ids drawn as volumes instead
uniform float uDirectionOnly;   // visibility of objects known only by direction (0 far from home)
uniform float uResolved;        // 1 in space: resolved nebulae get a long-exposure brightness floor
uniform vec3 uNorth;            // celestial north pole (ecliptic)
uniform float uAtlasCols;
varying vec2 vUv;
varying float vIntensity;
varying float vType;
varying float vSeed;
varying float vImage;
varying vec2 vTile;
const float PC_M = 3.0856775814913673e16;
void main() {
  bool hasDist = iParams.w > 0.0;
  bool image = iImage.x >= 0.0;
  // Image billboards span the image's field of view; the others the catalogued size.
  float extent = image ? (hasDist ? tan(iImage.y) * iParams.w : iImage.y) : iParams.x;
  vec3 rel;
  float radius, d;
  if (hasDist) {
    rel = iPos - uCamPc;
    d = max(length(rel), 1e-6);
    radius = extent;
  } else {
    rel = iPos * ${SHELL_PC.toExponential()};
    d = ${SHELL_PC.toExponential()};
    radius = extent * d;
  }
  float rpx = radius / d * uPxPerRad;
  // Apparent magnitude scales with distance for objects we can fly to.
  float mag = iParams.z + (hasDist ? 5.0 * log2(d / iParams.w) * 0.30103 : 0.0);
  float flux = pow(10.0, -0.4 * (mag - uMagRef)) * uGain;
  // Spread the light over the drawn area (an image: its square times its mean brightness).
  float area = image ? 4.0 * max(rpx * rpx, 1.0) * max(iImage.z, 0.01) : 3.14159 * max(rpx * rpx * iShape.x, 4.0);
  float id = float(gl_InstanceID);
  bool suppressed = id == uSuppress.x || id == uSuppress.y || id == uSuppress.z || id == uSuppress.w;
  float handover = (suppressed ? 0.0 : 1.0) * (hasDist ? 1.0 : uDirectionOnly);
  vIntensity = uVisibility * handover * flux / area;
  // Surface brightness doesn't grow as you approach, so close up a nebula would stay as faint per pixel
  // as it looks from Earth. Space views expose for it instead, like a long-exposure photograph.
  bool nebula = iParams.y > 1.5 && iParams.y < 5.5;
  if (nebula) vIntensity = max(vIntensity, uResolved * uVisibility * handover * (image ? 0.42 : 0.35) * smoothstep(25.0, 160.0, rpx));
  vUv = position.xy;
  vType = iParams.y;
  vSeed = iShape.y;
  vImage = image ? 1.0 : 0.0;
  float col = mod(iImage.x, uAtlasCols);
  vTile = vec2(col, uAtlasCols - 1.0 - floor(iImage.x / uAtlasCols));

  // Sky basis at the object as seen from home: east, north. Facing the camera, with
  // "up" towards celestial north, so from Earth the image sits exactly as on the sky.
  vec3 view = rel / d;
  vec3 dir = hasDist ? normalize(iPos) : iPos;
  vec3 east = cross(uNorth, dir);
  east = length(east) < 1e-5 ? vec3(1.0, 0.0, 0.0) : normalize(east);
  vec3 north = cross(dir, east);
  vec3 up = north - dot(north, view) * view;
  up = length(up) < 1e-5 ? normalize(cross(view, vec3(1.0, 0.0, 0.0))) : normalize(up);
  vec3 right = cross(view, up);   // = west when seen from Earth
  vec3 e1, e2;
  if (image) {
    e1 = right;
    e2 = up;
  } else {
    // Major axis at the catalogued position angle (north through east); random if unknown.
    float pa = iShape.z > -10.0 ? iShape.z : iShape.y * 6.2832;
    vec3 major = cos(pa) * up - sin(pa) * right;
    e1 = cross(major, view);
    e2 = major;
    e1 *= iShape.x;
  }
  vec3 p = rel + (e1 * position.x + e2 * position.y) * radius;
  gl_Position = projectionMatrix * viewMatrix * vec4(p * PC_M, 1.0);
  #include <logdepthbuf_vertex>
  if (vIntensity < 1e-5 || vType > 5.5 || rpx < 0.7) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const billboardFragment = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D uAtlas;
uniform float uAtlasCols;
varying vec2 vUv;
varying float vIntensity;
varying float vType;
varying float vSeed;
varying float vImage;
varying vec2 vTile;
${COMMON_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  vec3 c;
  if (vImage > 0.5) {
    // Inset a little so mipmaps don't bleed in from the neighbouring tile.
    vec2 uv = clamp(vUv * 0.5 + 0.5, 0.01, 0.99);
    c = texture2D(uAtlas, (vTile + uv) / uAtlasCols).rgb;
    c *= smoothstep(0.02, 0.09, max(c.r, max(c.g, c.b)));
  } else {
    if (length(vUv) > 1.0) discard;
    vec4 n = nebula(vType, vUv, vec3(vUv * 1.3, vSeed * 10.0), vSeed);
    c = n.rgb * n.a;
  }
  gl_FragColor = vec4(c * vIntensity, 1.0);
}
`;

const volumeVertex = 'varying vec3 vLocal; void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

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

/** Bounding sphere of an image volume, in units of the image half-width. */
const IMAGE_BOUND = 1.45;

const imageVolumeFragment = /* glsl */ `
// Frame: x = west, y = north (as on the image), z = towards Earth; units of the image half-width.
uniform vec3 uCamLocal;
uniform sampler2D uMap;
uniform vec4 uTile;     // atlas tile offset (xy), 1/columns (z), 1 = sample the atlas, 0 = full image (w)
uniform float uShell;   // 1: planetary nebula / remnant shell, 0: cloud
uniform float uDepth;
uniform float uSeed;
uniform float uGain;
varying vec3 vLocal;
${NOISE_GLSL}
vec3 image(vec2 xy) {
  vec2 uv = xy * 0.5 + 0.5;
  uv = uTile.w > 0.5 ? (uTile.xy + clamp(uv, 0.01, 0.99)) * uTile.z : uv;
  return texture2D(uMap, uv).rgb;
}
void main() {
  vec3 rd = normalize(vLocal - uCamLocal);
  float R2 = ${(IMAGE_BOUND * IMAGE_BOUND).toFixed(4)};
  float b = dot(uCamLocal, rd), c = dot(uCamLocal, uCamLocal) - R2, disc = b * b - c;
  if (disc <= 0.0) discard;
  float t0 = max(-b - sqrt(disc), 0.0), t1 = -b + sqrt(disc);
  const int N = 72;
  float ds = (t1 - t0) / float(N);
  float t = t0 + ds * ign(gl_FragCoord.xy);
  vec3 L = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = uCamLocal + rd * t;
    t += ds;
    if (abs(p.x) > 1.0 || abs(p.y) > 1.0) continue;
    float rho2 = dot(p.xy, p.xy);
    // Depth profile, normalised so the column along z integrates to 1: then from Earth
    // the volume reproduces the image exactly.
    float prof;
    if (uShell > 0.5) {
      // Two caps of a shell about the catalogued radius (≈ 0.74 of the half-width).
      float zs = sqrt(max(0.55 - rho2, 0.0));
      float a = (abs(p.z) - zs) / 0.1;
      prof = exp(-a * a) / (2.0 * 1.7725 * 0.1);
    } else {
      float H = uDepth * (0.3 + 0.7 * sqrt(max(1.0 - rho2, 0.0)));
      float a = p.z / H;
      prof = exp(-a * a) / (1.7725 * H);
    }
    // Only real nebulosity is extruded: the image's faint sky floor, integrated along a side-on
    // sightline through the slab, would otherwise show as a hard-edged sheet.
    vec3 I = image(p.xy);
    I *= smoothstep(0.02, 0.09, max(I.r, max(I.g, I.b)));
    if (I.r + I.g + I.b < 0.004) continue;
    // 3D structure: clumps and filaments that average to 1 along any line of sight.
    float m = 0.25 + 1.5 * fbm(p * 3.2 + uSeed * 17.0, 5);
    L += I * prof * m * ds;
  }
  gl_FragColor = vec4(L * uGain, 1.0);
}
`;

interface ActiveVolume {
  index: number;
  mesh: Mesh;
  material: ShaderMaterial;
  image: boolean;
}

export class DeepSkyLayer implements Layer {
  readonly object = new Group();
  private readonly material: ShaderMaterial;
  /** Per object: Sun-relative position (pc, ecliptic) or null if only the direction is known. */
  readonly positionsPc: (Vec3 | null)[];
  readonly directions: Vec3[];
  readonly radiusPc: number[];
  /** Per object: its survey image, if any. */
  readonly images: (ObjectImage | null)[];
  private readonly volumes: ActiveVolume[] = [];
  private readonly tmp: Vec3 = [0, 0, 0];
  private readonly atlas: Texture | null;
  private readonly loader = new TextureLoader();
  /** Full-resolution render textures for nebulae shown as volumes (small cache). */
  private readonly fullImages = new Map<string, Texture>();
  private readonly loaded = new WeakSet<Texture>();
  /** Volumes waiting for their full-resolution image, by file. */
  private readonly waiting = new Map<string, () => void>();
  private readonly m4 = new Matrix4();
  private readonly v3 = new Vector3();
  private lastMagRef = 5.5;
  readonly camPc: Vec3 = [0, 0, 0];
  enabled = true;

  constructor(
    readonly objects: DeepSkyObject[], private readonly sunFrame: Frame, private readonly volumePass: VolumePass,
    private readonly imageIndex: ImageIndex | null = null, private readonly imageBaseUrl = '',
  ) {
    const n = objects.length;
    const pos = new Float32Array(n * 3), params = new Float32Array(n * 4), shape = new Float32Array(n * 3);
    const img = new Float32Array(n * 4);
    this.positionsPc = [];
    this.directions = [];
    this.radiusPc = [];
    this.images = [];
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
      shape.set([q, hash01(i * 17 + 3), o.pa !== null ? o.pa * DEG : -100], i * 3);
      const im = imageIndex?.objects[o.id];
      const rendered = im && im.slot !== undefined && type >= 2 && type <= 5 ? im : null;
      this.images.push(im ?? null);
      img.set(rendered ? [rendered.slot!, (rendered.fov / 2) * DEG, rendered.mean ?? 0.1, 0] : [-1, 0, 0, 0], i * 4);
    });
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('iPos', new InstancedBufferAttribute(pos, 3));
    g.setAttribute('iParams', new InstancedBufferAttribute(params, 4));
    g.setAttribute('iShape', new InstancedBufferAttribute(shape, 3));
    g.setAttribute('iImage', new InstancedBufferAttribute(img, 4));
    g.instanceCount = n;
    this.atlas = imageIndex && Object.keys(imageIndex.objects).length ? this.loadTexture('atlas.jpg') : null;
    this.material = new ShaderMaterial({
      vertexShader: billboardVertex,
      fragmentShader: billboardFragment,
      uniforms: {
        uCamPc: { value: new Vector3() },
        uPxPerRad: { value: 1000 },
        uMagRef: { value: 5.5 },
        uGain: { value: 1 },
        uVisibility: { value: 1 },
        uSuppress: { value: new Vector4(-1, -1, -1, -1) },
        uDirectionOnly: { value: 1 },
        uResolved: { value: 1 },
        uNorth: { value: new Vector3(...CELESTIAL_NORTH) },
        uAtlas: { value: this.atlas },
        uAtlasCols: { value: imageIndex?.atlasCols ?? 16 },
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

  private loadTexture(path: string, onLoad?: () => void): Texture {
    const t = this.loader.load(new URL(path, this.imageBaseUrl).href, () => {
      this.loaded.add(t);
      onLoad?.();
    });
    t.colorSpace = SRGBColorSpace;
    return t;
  }

  /** Whether object i is drawn from a survey image. */
  hasImage(i: number): boolean {
    const im = this.images[i];
    return !!im && im.slot !== undefined;
  }

  update(ctx: RenderContext, magRef = 5.5, visibility = 1): void {
    this.object.visible = this.enabled;
    this.lastMagRef = magRef;
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
    u.uResolved!.value = ctx.sky ? 0 : 1;
    this.updateVolumes(ctx, visibility);
  }

  /** Half-width (pc) of the region a nebula is drawn over: its image's field, or its catalogued radius. */
  private extentPc(i: number): number {
    const im = this.images[i];
    const o = this.objects[i]!;
    return im && this.hasImage(i) && o.distPc ? Math.tan((im.fov / 2) * DEG) * o.distPc : this.radiusPc[i]!;
  }

  /** Ray-marched volumes for the nebulae the camera is closest to (relative to their size). */
  private updateVolumes(ctx: RenderContext, visibility: number): void {
    const candidates: { i: number; ratio: number }[] = [];
    this.positionsPc.forEach((p, i) => {
      const t = TYPE_CODE[this.objects[i]!.type] ?? 0;
      if (!p || t < 2 || t > 5) return;
      const d = Math.hypot(p[0] - this.camPc[0], p[1] - this.camPc[1], p[2] - this.camPc[2]);
      const ratio = d / Math.max(this.extentPc(i), 1e-6);
      if (ratio < 12) candidates.push({ i, ratio });
    });
    candidates.sort((a, b) => a.ratio - b.ratio);
    const keep = new Set(candidates.slice(0, MAX_VOLUMES).map((c) => c.i));
    for (let k = this.volumes.length - 1; k >= 0; k--) {
      const v = this.volumes[k]!;
      if (!keep.has(v.index)) {
        const im = this.images[v.index];
        if (im) this.waiting.delete(im.file);
        this.volumePass.scene.remove(v.mesh);
        v.mesh.geometry.dispose();
        v.material.dispose();
        this.volumes.splice(k, 1);
      }
    }
    for (const i of keep) if (!this.volumes.some((v) => v.index === i)) this.volumes.push(this.createVolume(i));
    // Every nebula drawn as a volume gives up its billboard (no double light).
    const sup = this.material.uniforms.uSuppress!.value as Vector4;
    sup.set(this.volumes[0]?.index ?? -1, this.volumes[1]?.index ?? -1, this.volumes[2]?.index ?? -1, -1);
    for (const v of this.volumes) {
      const p = this.positionsPc[v.index]!;
      const rel: Vec3 = [(p[0] - this.camPc[0]) * PC, (p[1] - this.camPc[1]) * PC, (p[2] - this.camPc[2]) * PC];
      v.mesh.position.set(...rel);
      if (v.image) this.placeImageVolume(v, rel, ctx, visibility);
      else {
        const r = this.radiusPc[v.index]! * PC;
        v.mesh.scale.setScalar(r);
        (v.material.uniforms.uCamLocal!.value as Vector3).set(-rel[0] / r, -rel[1] / r, -rel[2] / r);
        v.material.uniforms.uGain!.value = 0.25 * ctx.exposure.extendedGain;
      }
    }
  }

  /**
   * Orients an image volume in the sky basis at the object (x west, y north,
   * z towards Earth) and matches its brightness to the billboard it replaces.
   */
  private placeImageVolume(v: ActiveVolume, rel: Vec3, ctx: RenderContext, visibility: number): void {
    const i = v.index;
    const o = this.objects[i]!;
    const im = this.images[i]!;
    const dir = this.directions[i]!;
    const n = CELESTIAL_NORTH;
    let east: Vec3 = [n[1] * dir[2] - n[2] * dir[1], n[2] * dir[0] - n[0] * dir[2], n[0] * dir[1] - n[1] * dir[0]];
    const el = Math.hypot(...east) || 1;
    east = [east[0] / el, east[1] / el, east[2] / el];
    const north: Vec3 = [dir[1] * east[2] - dir[2] * east[1], dir[2] * east[0] - dir[0] * east[2], dir[0] * east[1] - dir[1] * east[0]];
    // Columns: west, north, towards Earth.
    this.m4.set(-east[0], north[0], -dir[0], 0, -east[1], north[1], -dir[1], 0, -east[2], north[2], -dir[2], 0, 0, 0, 0, 1);
    v.mesh.quaternion.setFromRotationMatrix(this.m4);
    const R = this.extentPc(i) * PC;
    v.mesh.scale.setScalar(R);
    // Camera in the local frame: Bᵀ (camera − centre) / R.
    const c = this.v3.set(-rel[0], -rel[1], -rel[2]);
    (v.material.uniforms.uCamLocal!.value as Vector3).set(
      (-east[0] * c.x - east[1] * c.y - east[2] * c.z) / R,
      (north[0] * c.x + north[1] * c.y + north[2] * c.z) / R,
      (-dir[0] * c.x - dir[1] * c.y - dir[2] * c.z) / R,
    );
    // Same light per pixel as the billboard: flux spread over the image square.
    const d = Math.hypot(...rel);
    const rpx = (R / d) * ctx.pixelsPerRadian * ctx.pixelRatio;
    const mag = (o.mag ?? DEFAULT_MAG[TYPE_CODE[o.type] ?? 2]!) + 5 * Math.log10(d / PC / o.distPc!);
    const flux = 10 ** (-0.4 * (mag - this.lastMagRef)) * ctx.exposure.extendedGain * 0.35;
    const physical = (visibility * flux) / (4 * Math.max(rpx * rpx, 1) * Math.max(im.mean ?? 0.1, 0.01));
    // The same long-exposure floor as the billboard it replaces.
    const t = Math.min(Math.max((rpx - 25) / 135, 0), 1);
    const floor = ctx.sky ? 0 : visibility * 0.42 * t * t * (3 - 2 * t);
    v.material.uniforms.uGain!.value = Math.max(physical, floor);
  }

  private createVolume(i: number): ActiveVolume {
    const o = this.objects[i]!;
    const im = this.images[i];
    const image = !!im && this.hasImage(i) && !!this.atlas;
    let material: ShaderMaterial;
    let geometry: SphereGeometry;
    if (image) {
      const cols = this.imageIndex!.atlasCols;
      const slot = im.slot!;
      const tile = new Vector4(slot % cols, cols - 1 - Math.floor(slot / cols), 1 / cols, 1);
      material = new ShaderMaterial({
        vertexShader: volumeVertex,
        fragmentShader: imageVolumeFragment,
        uniforms: {
          uCamLocal: { value: new Vector3() },
          uMap: { value: this.atlas },
          uTile: { value: tile },
          uShell: { value: o.type === 'PN' || o.type === 'SNR' ? 1 : 0 },
          uDepth: { value: IMAGE_DEPTH },
          uSeed: { value: hash01(i * 17 + 3) },
          uGain: { value: 0 },
        },
        side: BackSide,
        ...VOLUME_BLENDING,
      });
      // Swap the atlas tile for the full-resolution image once it arrives.
      const file = im.file;
      const useFull = () => {
        material.uniforms.uMap!.value = this.fullImages.get(file)!;
        tile.w = 0;
      };
      const cached = this.fullImages.get(file);
      if (cached && this.loaded.has(cached)) useFull();
      else {
        this.waiting.set(file, useFull);
        if (!cached) this.fullImages.set(file, this.loadTexture(`render/${file}`, () => this.waiting.get(file)?.()));
      }
      if (this.fullImages.size > 8) {
        const [oldest] = this.fullImages.keys();
        if (oldest !== im.file) {
          this.fullImages.get(oldest!)!.dispose();
          this.fullImages.delete(oldest!);
        }
      }
      geometry = new SphereGeometry(IMAGE_BOUND, 48, 24);
    } else {
      material = new ShaderMaterial({
        vertexShader: volumeVertex,
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
      geometry = new SphereGeometry(1, 48, 24);
    }
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.volumePass.scene.add(mesh);
    return { index: i, mesh, material, image };
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
    for (const t of this.fullImages.values()) t.dispose();
    this.atlas?.dispose();
    const mesh = this.object.children[0] as Mesh;
    mesh.geometry.dispose();
    this.material.dispose();
  }
}
