/** GLSL shared by the catalogue and procedural galaxy layers. */

import { STAR_PSF_FRAGMENT, STAR_PSF_VERTEX } from './shaders.ts';

/** Integrated colour (linear RGB, max ≈ 1) from a de Vaucouleurs T-type. */
export const GALAXY_COLOR_GLSL = /* glsl */ `
vec3 galaxyColor(float t) {
  vec3 early = vec3(1.0, 0.8, 0.6);
  vec3 late = vec3(0.68, 0.78, 1.0);
  return mix(early, late, smoothstep(-2.0, 9.0, t));
}
`;

const MPC_TO_M = '3.0856775814913673e22';

/**
 * Galaxies as photometric points (same PSF model as stars). `pos` is in Mpc
 * relative to `uOriginCamMpc`'s origin; points fade out as the galaxy's own
 * disc becomes resolved (`radiusMpc`), where the impostor takes over.
 */
export const GALAXY_POINT_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float absMag;
attribute float tType;
attribute float radiusMpc;
uniform vec3 uOriginCamMpc;   // camera position relative to this buffer's origin, Mpc
uniform float uPxPerRad;
uniform float uFade;           // layer-level fade (0–1)
uniform float uFogMpc;         // scale-dependent depth fog
varying vec3 vColor;
varying float vIntensity;
${STAR_PSF_VERTEX}
${GALAXY_COLOR_GLSL}
void main() {
  vec3 rel = position - uOriginCamMpc;
  float d = max(length(rel), 1e-9);
  float appMag = absMag + 5.0 * log2(d * 1e5) * 0.30103;   // d in Mpc → 10 pc units
  float rpx = radiusMpc / d * uPxPerRad;
  vec2 psf = starPsf(appMag);
  float handover = 1.0 - smoothstep(1.5, 4.0, rpx);
  vColor = galaxyColor(tType);
  vIntensity = min(psf.y, 1.5) * handover * uFade * (1.0 - smoothstep(uFogMpc, 4.0 * uFogMpc, d));
  gl_PointSize = psf.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(rel * ${MPC_TO_M}, 1.0);
  #include <logdepthbuf_vertex>
  if (psf.x == 0.0 || vIntensity < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const GALAXY_POINT_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying float vIntensity;
${STAR_PSF_FRAGMENT}
void main() {
  #include <logdepthbuf_fragment>
  float p = starProfile(gl_PointCoord);
  if (p <= 0.0) discard;
  gl_FragColor = vec4(vColor * vIntensity * p, 1.0);
}
`;

export { MPC_TO_M };
