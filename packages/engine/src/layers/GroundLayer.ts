/**
 * Opaque ground below the local horizon in Sky mode. Drawn after the sky
 * objects (so it hides anything that has set) and before the atmosphere dome
 * (so distant haze still tints the horizon).
 */

import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { Layer, RenderContext } from './types.ts';

const RADIUS = 4e4;

export class GroundLayer implements Layer {
  readonly object: Mesh;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uUp;
        uniform vec3 uColor;
        uniform float uLight;
        varying vec3 vDir;
        void main() {
          float h = dot(normalize(vDir), uUp);
          // Anti-aliased horizon edge, about a pixel wide at any zoom.
          float edge = 1.0 - smoothstep(-fwidth(h), 0.0, h);
          if (edge <= 0.0) discard;
          // Slightly lighter towards the horizon, where the ground is lit by sky glow.
          vec3 c = uColor * uLight * (0.55 + 0.45 * exp(h * 12.0));
          gl_FragColor = vec4(c, edge);
        }
      `,
      uniforms: {
        uUp: { value: new Vector3(0, 0, 1) },
        uColor: { value: new Color('#2a3326') },
        uLight: { value: 1 },
      },
      side: BackSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.object = new Mesh(new SphereGeometry(RADIUS, 96, 48), this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 40;
  }

  update(ctx: RenderContext): void {
    const sky = ctx.sky;
    this.object.visible = !!sky && sky.ground;
    if (!sky) return;
    (this.material.uniforms.uUp!.value as Vector3).set(...sky.rig.basis.up);
    // Daylight on the ground: full above ~10°, a faint glow through twilight, near-black at night.
    const s = Math.sin(sky.sunAlt);
    this.material.uniforms.uLight!.value = 0.04 + Math.min(Math.max((s + 0.1) / 0.27, 0), 1) * 1.6;
  }

  dispose(): void {
    this.material.dispose();
    this.object.geometry.dispose();
  }
}
