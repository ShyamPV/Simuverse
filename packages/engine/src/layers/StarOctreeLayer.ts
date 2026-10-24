/**
 * Streams the AT-HYG star octree (~2.4M Tycho-2/Gaia stars not in the bundled
 * HYG catalogue). Which nodes are shown depends only on what could be visible
 * from the camera (see selectOctreeNodes); tiles are fetched, cached and
 * decoded in workers, then drawn with the same photometric point shader as
 * the bright stars, each relative to its own node centre.
 */

import { ECLIPTIC_TO_EQUATORIAL, EQUATORIAL_TO_ECLIPTIC, PC, type Vec3, mulMat3Vec } from '@simuverse/astro';
import { type OctreeIndex, type StarTile, type TileLoader, selectOctreeNodes } from '@simuverse/data';
import { BufferAttribute, BufferGeometry, Group, Points, type ShaderMaterial, Vector3 } from 'three';
import type { Frame } from '../frames.ts';
import type { StarLayer } from './StarLayer.ts';
import type { Layer, RenderContext } from './types.ts';

const MAX_IN_FLIGHT = 6;
/** Seconds a tile lingers after it stops being selected (avoids thrash at boundaries). */
const EVICT_AFTER_S = 8;

interface LoadedTile {
  id: number;
  points: Points;
  material: ShaderMaterial;
  /** Node centre, pc, ecliptic. */
  center: Vec3;
  tile: StarTile;
  lastWanted: number;
}

export class StarOctreeLayer implements Layer {
  readonly object = new Group();
  private readonly tiles = new Map<number, LoadedTile>();
  private readonly inFlight = new Set<number>();
  private readonly failed = new Set<number>();
  private wanted = new Set<number>();
  private lastSelectAt = -Infinity;
  private lastCam: Vec3 = [Infinity, 0, 0];
  private magLimit = 8.5;
  /** Most stars kept on the GPU at once (set by the quality preset). */
  budget = 1_500_000;
  private readonly tmp: Vec3 = [0, 0, 0];
  private readonly centers: Vec3[];

  constructor(
    private readonly index: OctreeIndex,
    private readonly baseUrl: string,
    private readonly loader: TileLoader,
    private readonly sunFrame: Frame,
    /** The bright-star layer's material is cloned so both share one photometric model. */
    private readonly template: StarLayer,
  ) {
    this.centers = index.nodes.map((n) => mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, n.c));
  }

  get loadedStars(): number {
    let n = 0;
    for (const t of this.tiles.values()) n += t.tile.count;
    return n;
  }

  /** Iterate loaded stars (for picking): callback gets tile, index, camera-relative position in pc. */
  forEachStar(camPc: Readonly<Vec3>, cb: (tile: StarTile, i: number, rel: Vec3) => void): void {
    const rel: Vec3 = [0, 0, 0];
    for (const t of this.tiles.values()) {
      const p = t.tile.positions;
      for (let i = 0; i < t.tile.count; i++) {
        rel[0] = t.center[0] + p[i * 3]! - camPc[0];
        rel[1] = t.center[1] + p[i * 3 + 1]! - camPc[1];
        rel[2] = t.center[2] + p[i * 3 + 2]! - camPc[2];
        cb(t.tile, i, rel);
      }
    }
  }

  /** Looks up a loaded star by AT-HYG id. */
  findStar(id: number): { tile: StarTile; i: number; centerPc: Vec3 } | null {
    for (const t of this.tiles.values()) {
      const i = t.tile.ids.indexOf(id);
      if (i >= 0) return { tile: t.tile, i, centerPc: t.center };
    }
    return null;
  }

  setMagLimit(limit: number): void {
    this.magLimit = limit;
  }

  update(ctx: RenderContext): void {
    const s = ctx.toCamera(this.sunFrame, [0, 0, 0], this.tmp);
    const camEcl: Vec3 = [-s[0] / PC, -s[1] / PC, -s[2] / PC];
    const now = performance.now() / 1000;

    // Re-select when the camera has moved appreciably (relative to its distance from the Sun) or every 2 s.
    const moved = Math.hypot(camEcl[0] - this.lastCam[0], camEcl[1] - this.lastCam[1], camEcl[2] - this.lastCam[2]);
    const scale = Math.max(Math.hypot(...camEcl), 1);
    if (moved > scale * 0.05 || now - this.lastSelectAt > 2) {
      this.lastSelectAt = now;
      this.lastCam = camEcl;
      // Selection works in ICRS (the index's frame).
      const camEq = mulMat3Vec(ECLIPTIC_TO_EQUATORIAL, camEcl);
      // A little headroom over the render limit so stars fade in rather than pop.
      this.wanted = new Set(selectOctreeNodes(this.index, camEq, this.magLimit + 0.5, this.budget).map((s) => s.id));
    }

    for (const id of this.wanted) {
      const t = this.tiles.get(id);
      if (t) t.lastWanted = now;
      else if (!this.inFlight.has(id) && !this.failed.has(id) && this.inFlight.size < MAX_IN_FLIGHT) this.load(id);
    }
    for (const [id, t] of this.tiles) {
      if (!this.wanted.has(id) && now - t.lastWanted > EVICT_AFTER_S) this.evict(id);
    }

    const tm = this.template.material.uniforms;
    for (const t of this.tiles.values()) {
      const u = t.material.uniforms;
      (u.uCamPc!.value as Vector3).set(camEcl[0] - t.center[0], camEcl[1] - t.center[1], camEcl[2] - t.center[2]);
      for (const k of ['uMagRef', 'uMagLimit', 'uPixelRatio', 'uSky', 'uExtinction']) u[k]!.value = tm[k]!.value;
      (u.uVelocityC!.value as Vector3).copy(tm.uVelocityC!.value as Vector3);
      (u.uZenith!.value as Vector3).copy(tm.uZenith!.value as Vector3);
    }
  }

  private load(id: number): void {
    this.inFlight.add(id);
    const node = this.index.nodes[id]!;
    this.loader
      .starTile(new URL(`stars/t/${id}.bin`, this.baseUrl).href, node)
      .then((tile) => {
        this.inFlight.delete(id);
        if (!this.wanted.has(id)) return;
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(tile.positions, 3));
        g.setAttribute('absMag', new BufferAttribute(tile.absMag, 1));
        g.setAttribute('color', new BufferAttribute(tile.colors, 3));
        const material = this.template.material.clone();
        const points = new Points(g, material);
        points.frustumCulled = false;
        points.renderOrder = -10;
        this.object.add(points);
        this.tiles.set(id, { id, points, material, center: this.centers[id]!, tile, lastWanted: performance.now() / 1000 });
      })
      .catch((err) => {
        this.inFlight.delete(id);
        this.failed.add(id);
        console.warn(`Star tile ${id} failed`, err);
      });
  }

  private evict(id: number): void {
    const t = this.tiles.get(id);
    if (!t) return;
    this.object.remove(t.points);
    t.points.geometry.dispose();
    t.material.dispose();
    this.tiles.delete(id);
  }

  dispose(): void {
    for (const id of [...this.tiles.keys()]) this.evict(id);
  }
}
