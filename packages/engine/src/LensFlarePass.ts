/**
 * Optional lens flare from the Sun: a few ghosts reflected through the image
 * centre, a halo and a thin anamorphic streak, added to the HDR image before
 * tone mapping. Whether and how strongly it shows is decided on the CPU
 * (Sun in view, not behind a planet or the ground, bright enough).
 */

import { Vector2 } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const shader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uIntensity: { value: 0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uSun;
uniform float uAspect;
uniform float uIntensity;
varying vec2 vUv;

// A soft-edged disc with a slightly brighter rim, like an aperture ghost.
float ghost(vec2 centre, float r) {
  float l = length((vUv - centre) * vec2(uAspect, 1.0));
  return smoothstep(r, r * 0.7, l) * 0.6 + smoothstep(r * 0.08, 0.0, abs(l - r * 0.92)) * 0.4;
}

void main() {
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  if (uIntensity > 0.0) {
    vec2 axis = vec2(0.5) - uSun;
    vec3 f = vec3(0.0);
    f += ghost(uSun + axis * 0.45, 0.035) * vec3(0.55, 0.75, 1.0) * 0.20;
    f += ghost(uSun + axis * 0.80, 0.020) * vec3(1.0, 0.85, 0.55) * 0.25;
    f += ghost(uSun + axis * 1.25, 0.060) * vec3(0.45, 1.0, 0.70) * 0.10;
    f += ghost(uSun + axis * 1.55, 0.025) * vec3(0.70, 0.55, 1.0) * 0.22;
    f += ghost(uSun + axis * 2.10, 0.090) * vec3(0.50, 0.70, 1.0) * 0.07;
    vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
    float r = length(d);
    // Halo ring and the anamorphic streak.
    f += smoothstep(0.012, 0.0, abs(r - 0.32)) * vec3(0.6, 0.8, 1.0) * 0.06;
    f += exp(-abs(d.y) * 900.0) * exp(-abs(d.x) * 2.5) * vec3(0.55, 0.7, 1.0) * 0.5;
    col += f * uIntensity;
  }
  gl_FragColor = vec4(col, 1.0);
}
`,
};

export class LensFlarePass extends ShaderPass {
  constructor() {
    super(shader);
    this.enabled = false;
  }

  /** sun: position in 0–1 screen coordinates (y up); intensity 0 hides the flare. */
  set(sun: [number, number] | null, intensity: number, aspect: number): void {
    const u = this.uniforms as typeof shader.uniforms;
    if (sun) u.uSun.value.set(sun[0], sun[1]);
    u.uIntensity.value = sun ? intensity : 0;
    u.uAspect.value = aspect;
  }
}
