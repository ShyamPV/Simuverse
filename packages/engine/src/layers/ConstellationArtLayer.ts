/**
 * Constellation artwork (Stellarium's modern figures, by Johan Meuris), drawn
 * additively on the far shell behind the stick figures. Each figure is a small
 * mesh whose vertices were placed on the sky at build time from three anchor
 * stars (tools/build-constellation-art.mjs).
 */

import { EQUATORIAL_TO_ECLIPTIC, type Vec3, mulMat3Vec } from '@simuverse/astro';
import type { ConstellationArt } from '@simuverse/data';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, LinearMipmapLinearFilter, Mesh, ShaderMaterial, SRGBColorSpace,
  type Texture,
} from 'three';
import type { RenderContext } from './types.ts';

const SHELL_RADIUS = 1e12;
const OPACITY = 0.2;

const vertexShader = /* glsl */ `
uniform float uShellRadius;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * (viewMatrix * vec4(normalize(position) * uShellRadius, 1.0));
}
`;
const fragmentShader = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float a = texture2D(uAtlas, vUv).r;
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}
`;

export class ConstellationArtLayer {
  readonly object: Mesh;
  private readonly material: ShaderMaterial;
  visible = true;

  constructor(art: ConstellationArt, atlas: Texture, anisotropy: number) {
    const n = art.grid + 1;
    const vertsPer = n * n;
    const positions = new Float32Array(art.figures.length * vertsPer * 3);
    const uvs = new Float32Array(art.figures.length * vertsPer * 2);
    const index: number[] = [];
    const w = art.cols * art.tile, h = art.rows * art.tile;
    // The image fills the slot inside a 2 px margin.
    const inset = 2 / art.tile;
    art.figures.forEach((f, k) => {
      const base = k * vertsPer;
      const sx = (f.slot % art.cols) * art.tile, sy = Math.floor(f.slot / art.cols) * art.tile;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const v = j * n + i;
          const d = mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, f.dirs.slice(v * 3, v * 3 + 3) as Vec3);
          positions.set(d, (base + v) * 3);
          const fx = inset + (i / art.grid) * (1 - 2 * inset), fy = inset + (j / art.grid) * (1 - 2 * inset);
          // Texture v runs bottom-up; the atlas image (and the grid) top-down.
          uvs.set([(sx + fx * art.tile) / w, 1 - (sy + fy * art.tile) / h], (base + v) * 2);
        }
      }
      for (let j = 0; j < art.grid; j++) {
        for (let i = 0; i < art.grid; i++) {
          const a = base + j * n + i, b = a + 1, c = a + n, d = c + 1;
          index.push(a, c, b, b, c, d);
        }
      }
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('uv', new BufferAttribute(uvs, 2));
    g.setIndex(index);

    atlas.colorSpace = SRGBColorSpace;
    atlas.minFilter = LinearMipmapLinearFilter;
    atlas.anisotropy = anisotropy;
    atlas.needsUpdate = true;
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uShellRadius: { value: SHELL_RADIUS },
        uAtlas: { value: atlas },
        uColor: { value: new Color('#9fb4ff') },
        uOpacity: { value: OPACITY },
      },
      // Like the stick figures: opaque pass, additive, under everything else.
      blending: AdditiveBlending,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    this.object = new Mesh(g, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -6;
  }

  /** `fade`: the constellation layer's visibility (distance from the Sun, sky brightness). */
  update(_ctx: RenderContext, fade: number): void {
    this.object.visible = this.visible && fade > 0;
    this.material.uniforms.uOpacity!.value = OPACITY * fade;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
    (this.material.uniforms.uAtlas!.value as Texture).dispose();
  }
}
