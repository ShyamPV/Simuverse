/** Shader materials for solar-system bodies. All output linear HDR. */

import {
  AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, ShaderMaterial,
  type Texture, Vector3,
} from 'three';
import { STAR_PSF_FRAGMENT, STAR_PSF_VERTEX } from './shaders.ts';

/**
 * Unit sphere with z as the pole and u = 0.5 on the +x (prime) meridian, so
 * equirectangular maps line up with IAU body-fixed axes.
 */
export function createBodyGeometry(widthSegments = 128, heightSegments = 64): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let iy = 0; iy <= heightSegments; iy++) {
    const v = iy / heightSegments;
    const lat = (v - 0.5) * Math.PI;
    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments;
      const lon = u * 2 * Math.PI - Math.PI;
      pos.push(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
      uv.push(u, v);
    }
  }
  const row = widthSegments + 1;
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = iy * row + ix, b = a + row, c = b + 1, d = a + 1;
      idx.push(a, d, c, a, c, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const bodyVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vPosV;
void main() {
  vUv = uv;
  vNormalV = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPosV = mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const planetFragment = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform sampler2D nightMap;
uniform float hasMap;
uniform float hasNight;
uniform vec3 baseColor;
uniform vec3 sunDirV;
uniform float sunIntensity;
uniform vec3 atmoColor;
uniform float atmoStrength;
uniform float alphaFromLuma;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vPosV;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalV);
  vec3 v = normalize(-vPosV);
  vec4 tex = hasMap > 0.5 ? texture2D(map, vUv) : vec4(baseColor, 1.0);
  float ndl = dot(n, sunDirV);
  // Slightly softened terminator; real scattering arrives with the atmosphere shader.
  float diffuse = smoothstep(-0.04, 0.12, ndl) * max(ndl, 0.0) + smoothstep(-0.04, 0.12, ndl) * 0.02;
  vec3 col = tex.rgb * diffuse * sunIntensity;
  if (hasNight > 0.5) {
    float night = 1.0 - smoothstep(-0.12, 0.06, ndl);
    col += texture2D(nightMap, vUv).rgb * night * 1.2;
  }
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += atmoColor * rim * atmoStrength * smoothstep(-0.25, 0.35, ndl);
  float alpha = alphaFromLuma > 0.5 ? tex.r : 1.0;
  gl_FragColor = vec4(col * (alphaFromLuma > 0.5 ? alpha : 1.0), alpha);
}
`;

export interface PlanetMaterialOptions {
  map?: Texture;
  nightMap?: Texture;
  color: Color;
  atmoColor?: Color;
  atmoStrength?: number;
  /** For cloud layers: use the texture's luminance as alpha. */
  clouds?: boolean;
}

export function createPlanetMaterial(o: PlanetMaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: bodyVertex,
    fragmentShader: planetFragment,
    uniforms: {
      map: { value: o.map ?? null },
      nightMap: { value: o.nightMap ?? null },
      hasMap: { value: o.map ? 1 : 0 },
      hasNight: { value: o.nightMap ? 1 : 0 },
      baseColor: { value: o.color },
      sunDirV: { value: new Vector3(1, 0, 0) },
      sunIntensity: { value: 1.6 },
      atmoColor: { value: o.atmoColor ?? new Color(0, 0, 0) },
      atmoStrength: { value: o.atmoStrength ?? 0 },
      alphaFromLuma: { value: o.clouds ? 1 : 0 },
    },
    transparent: !!o.clouds,
    depthWrite: !o.clouds,
    premultipliedAlpha: !!o.clouds,
  });
}

const sunFragment = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform float intensity;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vPosV;
void main() {
  #include <logdepthbuf_fragment>
  float mu = max(dot(normalize(vNormalV), normalize(-vPosV)), 0.0);
  float limb = 1.0 - 0.6 * (1.0 - mu); // linear limb darkening, u ≈ 0.6 in the visible
  vec3 tex = texture2D(map, vUv).rgb;
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.82) * (0.55 + 0.9 * tex) * limb * intensity, 1.0);
}
`;

export function createSunMaterial(map: Texture): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: bodyVertex,
    fragmentShader: sunFragment,
    uniforms: { map: { value: map }, intensity: { value: 14 } },
  });
}

/** Single-point glow for the Sun: star-like when far, a halo when near. */
export function createSunGlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uAppMag;
      uniform float uHaloPx;
      varying float vIntensity;
      varying float vHalo;
      ${STAR_PSF_VERTEX}
      void main() {
        vec2 psf = starPsf(uAppMag);
        float halo = uHaloPx * uPixelRatio;
        gl_PointSize = max(psf.x, halo);
        vIntensity = psf.y;
        vHalo = psf.x > 0.0 ? psf.x / max(gl_PointSize, 1.0) : 0.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      varying float vIntensity;
      varying float vHalo;
      ${STAR_PSF_FRAGMENT}
      void main() {
        #include <logdepthbuf_fragment>
        vec2 d = gl_PointCoord * 2.0 - 1.0;
        float r = length(d);
        if (r > 1.0) discard;
        // Star core scaled into the inner part of the sprite, plus a soft corona.
        float core = vHalo > 0.0 ? starProfile((d / max(vHalo, 1e-3)) * 0.5 + 0.5) : 0.0;
        float corona = pow(1.0 - r, 3.0) * 0.6;
        gl_FragColor = vec4(vec3(1.0, 0.92, 0.8) * (core * vIntensity + corona), 1.0);
      }
    `,
    uniforms: {
      uAppMag: { value: -26.7 },
      uHaloPx: { value: 0 },
      uMagRef: { value: 4 },
      uMagLimit: { value: 8 },
      uPixelRatio: { value: 1 },
      uMaxSize: { value: 64 },
    },
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
}

/**
 * Planetary ring lit by the Sun, with the planet's shadow cast onto it via a
 * ray–sphere test in view space. The ring texture is a radial strip (u = r).
 */
export function createRingMaterial(map: Texture, inner: number, outer: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vLocal;
      varying vec3 vPosV;
      void main() {
        vLocal = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPosV = mv.xyz;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D map;
      uniform float inner;
      uniform float outer;
      uniform vec3 sunDirV;
      uniform vec3 planetCenterV;
      uniform float planetRadius;
      uniform vec3 ringNormalV;
      uniform float sunIntensity;
      varying vec3 vLocal;
      varying vec3 vPosV;
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vLocal.xy);
        float u = (r - inner) / (outer - inner);
        if (u < 0.0 || u > 1.0) discard;
        vec4 tex = texture2D(map, vec2(u, 0.5));
        // Planet shadow: does the ray towards the Sun hit the planet?
        vec3 oc = vPosV - planetCenterV;
        float b = dot(oc, sunDirV);
        float c = dot(oc, oc) - planetRadius * planetRadius;
        float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.08 : 1.0;
        // Lit face vs the unlit face (seen in forward-scattered light, much dimmer).
        float sunSide = dot(ringNormalV, sunDirV);
        float viewSide = dot(ringNormalV, normalize(-vPosV));
        float lit = sign(sunSide) == sign(viewSide) ? 1.0 : 0.25;
        float light = (0.15 + 0.85 * abs(sunSide)) * lit * shadow * sunIntensity;
        gl_FragColor = vec4(tex.rgb * light * tex.a, tex.a);
      }
    `,
    uniforms: {
      map: { value: map },
      inner: { value: inner },
      outer: { value: outer },
      sunDirV: { value: new Vector3(1, 0, 0) },
      planetCenterV: { value: new Vector3() },
      planetRadius: { value: 1 },
      ringNormalV: { value: new Vector3(0, 0, 1) },
      sunIntensity: { value: 1.6 },
    },
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
  });
}
