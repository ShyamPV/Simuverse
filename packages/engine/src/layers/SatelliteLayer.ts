/**
 * Bright artificial satellites (ISS, Tiangong, Hubble, …) propagated with
 * SGP4 every frame. In Sky mode they appear only when sunlit and bright
 * enough against the sky; from space near Earth every tracked object is shown
 * as a small dot.
 */

import {
  type Satellite, type Vec3, angleBetween, inEarthShadow, mulMat3Vec, satelliteItrs, satelliteMagnitude,
} from '@simuverse/astro';
import { BufferAttribute, BufferGeometry, Points, type ShaderMaterial } from 'three';
import type { SolarSystemModel } from '../SolarSystemModel.ts';
import { createBodyPointsMaterial } from './bodyMaterials.ts';
import type { Layer, RenderContext } from './types.ts';

/** Beyond this distance from Earth's centre satellites aren't drawn (metres). */
const MAX_VIEW_DISTANCE = 2e8;
/** Fixed magnitude for the "all tracked objects" dots seen from space. */
const SPACE_VIEW_MAG = 3.5;

export interface SatelliteView {
  id: number;
  name: string;
  /** Camera → satellite, metres. */
  rel: Vec3;
  magnitude: number;
  /** Drawn this frame (sunlit, above the limit, propagation succeeded). */
  visible: boolean;
  sunlit: boolean;
}

export class SatelliteLayer implements Layer {
  readonly object: Points;
  readonly views: SatelliteView[];
  private readonly material: ShaderMaterial;
  enabled = true;

  private readonly itrs: Vec3 = [0, 0, 0];
  private readonly earthRel: Vec3 = [0, 0, 0];
  private readonly sunRel: Vec3 = [0, 0, 0];

  constructor(readonly satellites: Satellite[], private readonly model: SolarSystemModel) {
    const n = satellites.length;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('mag', new BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('visible', new BufferAttribute(new Float32Array(n), 1));
    const colors = new Float32Array(n * 3).fill(1);
    for (let i = 0; i < n; i++) colors[i * 3 + 2] = 0.92; // faintly warm sunlit-metal tint
    g.setAttribute('color', new BufferAttribute(colors, 3));
    this.material = createBodyPointsMaterial();
    this.object = new Points(g, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 6;
    this.views = satellites.map((s) => ({
      id: s.noradId, name: s.name, rel: [0, 0, 0], magnitude: 99, visible: false, sunlit: false,
    }));
  }

  setPhotometry(magRef: number, magLimit: number): void {
    this.material.uniforms.uMagRef!.value = magRef;
    this.material.uniforms.uMagLimit!.value = magLimit;
  }

  update(ctx: RenderContext): void {
    const earth = this.model.get('earth')!;
    ctx.toCamera(earth.frame, [0, 0, 0], this.earthRel);
    ctx.toCamera(this.model.get('sun')!.frame, [0, 0, 0], this.sunRel);
    const near = ctx.sky || Math.hypot(...this.earthRel) < MAX_VIEW_DISTANCE;
    this.object.visible = this.enabled && !!near;
    if (!this.object.visible) {
      for (const v of this.views) v.visible = false;
      return;
    }
    const pos = this.object.geometry.getAttribute('position') as BufferAttribute;
    const mag = this.object.geometry.getAttribute('mag') as BufferAttribute;
    const vis = this.object.geometry.getAttribute('visible') as BufferAttribute;
    const m = this.model.earth.itrsToEcliptic;
    const sunGeo: Vec3 = [
      (this.sunRel[0] - this.earthRel[0]) / 1000, (this.sunRel[1] - this.earthRel[1]) / 1000, (this.sunRel[2] - this.earthRel[2]) / 1000,
    ];
    const jdUtc = ctx.time.jdUtc;
    const sky = ctx.sky;

    this.satellites.forEach((sat, i) => {
      const v = this.views[i]!;
      v.visible = false;
      if (!satelliteItrs(sat, jdUtc, this.itrs)) {
        vis.setX(i, 0);
        return;
      }
      const geo = mulMat3Vec(m, this.itrs); // km, geocentric, world axes
      if (sky) {
        const o = sky.observer.geocentric;
        v.rel[0] = (geo[0] - o[0]) * 1000;
        v.rel[1] = (geo[1] - o[1]) * 1000;
        v.rel[2] = (geo[2] - o[2]) * 1000;
      } else {
        v.rel[0] = this.earthRel[0] + geo[0] * 1000;
        v.rel[1] = this.earthRel[1] + geo[1] * 1000;
        v.rel[2] = this.earthRel[2] + geo[2] * 1000;
      }
      v.sunlit = !inEarthShadow(geo, sunGeo);
      const rangeKm = Math.hypot(...v.rel) / 1000;
      if (sky) {
        const toSun: Vec3 = [sunGeo[0] - geo[0], sunGeo[1] - geo[1], sunGeo[2] - geo[2]];
        const phase = angleBetween(toSun, [-v.rel[0], -v.rel[1], -v.rel[2]]);
        v.magnitude = v.sunlit ? satelliteMagnitude(sat.stdMag, rangeKm, phase) : 99;
        v.visible = v.sunlit && v.magnitude < sky.limitMag;
      } else {
        v.magnitude = SPACE_VIEW_MAG;
        v.visible = true;
      }
      pos.setXYZ(i, v.rel[0], v.rel[1], v.rel[2]);
      mag.setX(i, v.magnitude);
      vis.setX(i, v.visible ? 1 : 0);
    });
    pos.needsUpdate = mag.needsUpdate = vis.needsUpdate = true;
    this.material.uniforms.uPixelRatio!.value = ctx.pixelRatio;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
