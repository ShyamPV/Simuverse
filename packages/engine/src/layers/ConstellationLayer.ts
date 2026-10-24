/**
 * Constellation stick figures and IAU boundaries, drawn as directions on the
 * far shell (like stars). Figures follow great circles between stars;
 * boundaries follow lines of constant RA or Dec, so their edges are
 * interpolated in RA/Dec rather than as chords.
 */

import { DEG, EQUATORIAL_TO_ECLIPTIC, type Vec3, mulMat3Vec, sphericalToCartesian } from '@simuverse/astro';
import type { Constellations } from '@simuverse/data';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, LineSegments, ShaderMaterial } from 'three';
import type { Layer, RenderContext } from './types.ts';

const SHELL_RADIUS = 1e12;
const MAX_STEP_DEG = 1;

const vertexShader = /* glsl */ `
uniform float uShellRadius;
void main() {
  gl_Position = projectionMatrix * (viewMatrix * vec4(normalize(position) * uShellRadius, 1.0));
}
`;
const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor * uOpacity, 1.0); }
`;

function dir(raDeg: number, decDeg: number): Vec3 {
  return mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, sphericalToCartesian(raDeg * DEG, decDeg * DEG));
}

/** Great-circle subdivision of a polyline into segment pairs. */
function figureSegments(lines: [number, number][][], out: number[]): void {
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = dir(...line[i - 1]!), b = dir(...line[i]!);
      const ang = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      const n = Math.max(1, Math.ceil(ang / (MAX_STEP_DEG * DEG)));
      let prev = a;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        // Normalised lerp is adequate for ≤1° steps (the shader normalises again).
        const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        out.push(...prev, ...p);
        prev = p;
      }
    }
  }
}

/** RA/Dec-linear subdivision of closed polygons into segment pairs. */
function boundarySegments(polys: [number, number][][], out: number[]): void {
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [ra0, de0] = poly[i]!;
      const [ra1raw, de1] = poly[(i + 1) % poly.length]!;
      let dra = ra1raw - ra0;
      if (dra > 180) dra -= 360;
      if (dra < -180) dra += 360;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dra), Math.abs(de1 - de0)) / MAX_STEP_DEG));
      let prev = dir(ra0, de0);
      for (let k = 1; k <= n; k++) {
        const p = dir(ra0 + (dra * k) / n, de0 + ((de1 - de0) * k) / n);
        out.push(...prev, ...p);
        prev = p;
      }
    }
  }
}

function makeLines(positions: number[], color: string, opacity: number): LineSegments {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  const m = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uShellRadius: { value: SHELL_RADIUS }, uColor: { value: new Color(color) }, uOpacity: { value: opacity } },
    // Opaque pass (drawn before planets, which then cover it) with additive blending,
    // like the stars; a transparent material would be drawn over planets.
    blending: AdditiveBlending,
    transparent: false,
    depthTest: false,
    depthWrite: false,
  });
  const l = new LineSegments(g, m);
  l.frustumCulled = false;
  l.renderOrder = -5;
  return l;
}

export interface ConstellationLabel {
  id: string;
  name: string;
  rank: number;
  /** Ecliptic J2000 unit vector. */
  dir: Vec3;
}

export class ConstellationLayer implements Layer {
  readonly object = new Group();
  readonly labels: ConstellationLabel[];
  private readonly figures: LineSegments;
  private readonly bounds: LineSegments;
  showFigures = true;
  showBounds = false;
  /** 0–1 visibility, faded out as the camera leaves the solar system. */
  fade = 1;

  constructor(data: Constellations) {
    const fig: number[] = [], bnd: number[] = [];
    this.labels = [];
    for (const [id, c] of Object.entries(data)) {
      figureSegments(c.lines, fig);
      boundarySegments(c.bounds, bnd);
      this.labels.push({ id, name: c.name, rank: c.rank, dir: dir(...c.label) });
    }
    this.figures = makeLines(fig, '#5eead4', 0.32);
    this.bounds = makeLines(bnd, '#9d90ff', 0.18);
    this.object.add(this.figures, this.bounds);
  }

  update(ctx: RenderContext): void {
    // Constellations only make sense from (near) the solar system.
    const sun = ctx.toCamera(ctx.frames.require('sun'), [0, 0, 0], [0, 0, 0]);
    const dAu = Math.hypot(...sun) / 1.495978707e11;
    // Fade with distance from the solar system and, on the ground, with sky brightness
    // (gone by day, half strength in civil twilight, full once stars to mag ~3 show).
    const dayFade = ctx.sky ? Math.min(Math.max((ctx.sky.limitMag + 3) / 6, 0), 1) : 1;
    this.fade = Math.min(Math.max((5000 - dAu) / 4000, 0), 1) * dayFade;
    this.figures.visible = this.showFigures && this.fade > 0;
    this.bounds.visible = this.showBounds && this.fade > 0;
    (this.figures.material as ShaderMaterial).uniforms.uOpacity!.value = 0.32 * this.fade;
    (this.bounds.material as ShaderMaterial).uniforms.uOpacity!.value = 0.18 * this.fade;
  }

  dispose(): void {
    for (const l of [this.figures, this.bounds]) {
      l.geometry.dispose();
      (l.material as ShaderMaterial).dispose();
    }
  }
}
