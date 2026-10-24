/**
 * Catalogue stars as GPU points. Positions stay in parsecs relative to the Sun
 * (float32 is ample at that scale); each frame the camera's position relative
 * to the Sun is computed in float64 and passed as a uniform, so the shader
 * only ever subtracts nearby-magnitude numbers. Stars render as directions on
 * a far shell with no depth test, so they never fight with depth precision.
 */

import { PC, type Vec3 } from '@simuverse/astro';
import type { StarBuffers } from '@simuverse/data';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3,
} from 'three';
import type { Frame } from '../frames.ts';
import { STAR_PSF_FRAGMENT, STAR_PSF_VERTEX } from './shaders.ts';
import type { Layer, RenderContext } from './types.ts';

const SHELL_RADIUS = 1e12; // metres; well inside the far plane, beyond any solid body we draw.

const vertexShader = /* glsl */ `
attribute float absMag;
attribute vec3 color;
uniform vec3 uCamPc;
uniform float uShellRadius;
// Sky mode: observer velocity / c (aberration), local zenith, extinction (mag per airmass).
uniform float uSky;
uniform vec3 uVelocityC;
uniform vec3 uZenith;
uniform float uExtinction;
varying vec3 vColor;
varying float vIntensity;
${STAR_PSF_VERTEX}
void main() {
  vec3 rel = position - uCamPc;
  float d = max(length(rel), 1e-9);
  float appMag = absMag + 5.0 * log2(d / 10.0) * 0.30103;
  vec3 dir = rel / d;
  if (uSky > 0.5) {
    dir = normalize(dir + uVelocityC);
    float s = max(dot(dir, uZenith), 0.0);
    // Rozenberg (1966) airmass; finite at the horizon.
    appMag += uExtinction / (s + 0.025 * exp(-11.0 * s));
  }
  vec2 psf = starPsf(appMag);
  vColor = color;
  vIntensity = psf.y;
  gl_PointSize = psf.x;
  gl_Position = projectionMatrix * (viewMatrix * vec4(dir * uShellRadius, 1.0));
  if (psf.x == 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // clip away
}
`;

/** Typical extinction coefficient in V at a good site, magnitudes per airmass. */
export const EXTINCTION_V = 0.2;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vIntensity;
${STAR_PSF_FRAGMENT}
void main() {
  float p = starProfile(gl_PointCoord);
  if (p <= 0.0) discard;
  gl_FragColor = vec4(vColor * vIntensity * p, 1.0);
}
`;

export interface StarPhotometry {
  /** Magnitude rendered at unit HDR intensity. */
  magRef: number;
  /** Faintest magnitude drawn. */
  magLimit: number;
}

export class StarLayer implements Layer {
  readonly object: Points;
  readonly material: ShaderMaterial;
  private readonly tmp: Vec3 = [0, 0, 0];

  constructor(
    readonly stars: StarBuffers,
    private readonly sunFrame: Frame,
    photometry: StarPhotometry,
  ) {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(stars.positions, 3));
    geom.setAttribute('absMag', new BufferAttribute(stars.absMag, 1));
    geom.setAttribute('color', new BufferAttribute(stars.colors, 3));
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uCamPc: { value: new Vector3() },
        uShellRadius: { value: SHELL_RADIUS },
        uMagRef: { value: photometry.magRef },
        uMagLimit: { value: photometry.magLimit },
        uPixelRatio: { value: 1 },
        uMaxSize: { value: 48 },
        uSky: { value: 0 },
        uVelocityC: { value: new Vector3() },
        uZenith: { value: new Vector3(0, 0, 1) },
        uExtinction: { value: 0 },
      },
      // Opaque pass (not `transparent`) so stars draw first and planets cover them;
      // additive blending still applies because three only drops NormalBlending for opaque materials.
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.object = new Points(geom, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -10;
  }

  setPhotometry(p: Partial<StarPhotometry>): void {
    if (p.magRef !== undefined) this.material.uniforms.uMagRef!.value = p.magRef;
    if (p.magLimit !== undefined) this.material.uniforms.uMagLimit!.value = p.magLimit;
  }

  update(ctx: RenderContext): void {
    // Camera position relative to the Sun = −(camera → Sun).
    const v = ctx.toCamera(this.sunFrame, [0, 0, 0], this.tmp);
    const u = this.material.uniforms;
    (u.uCamPc!.value as Vector3).set(-v[0] / PC, -v[1] / PC, -v[2] / PC);
    u.uPixelRatio!.value = ctx.pixelRatio;
    const sky = ctx.sky;
    u.uSky!.value = sky ? 1 : 0;
    if (sky) {
      (u.uVelocityC!.value as Vector3).set(...sky.velocityC);
      (u.uZenith!.value as Vector3).set(...sky.rig.basis.up);
      u.uExtinction!.value = sky.atmosphere ? EXTINCTION_V : 0;
    }
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
