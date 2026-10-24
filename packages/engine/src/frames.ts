/**
 * Hierarchical translational reference frames (all share ecliptic J2000 axes).
 *
 * Every position in the engine is a (frame, local offset in metres) pair held
 * in float64. Differences between two such points are accumulated only up to
 * their lowest common ancestor, so precision depends on the distance between
 * the points rather than on their distance from any global origin. This is
 * what lets the camera sit 1 m above the Moon while the scene spans Gpc.
 */

import type { AstroTime, Vec3 } from '@simuverse/astro';

export type OriginFn = (t: AstroTime, out: Vec3) => void;

export class Frame {
  readonly depth: number;
  /** Origin of this frame in its parent, metres, updated by FrameGraph.update(). */
  readonly origin: Vec3 = [0, 0, 0];

  constructor(
    readonly id: string,
    readonly parent: Frame | null,
    readonly computeOrigin: OriginFn | null,
  ) {
    this.depth = parent ? parent.depth + 1 : 0;
  }
}

export class FrameGraph {
  readonly root: Frame;
  private readonly frames = new Map<string, Frame>();
  private readonly ordered: Frame[] = [];
  private readonly a: Vec3 = [0, 0, 0];
  private readonly b: Vec3 = [0, 0, 0];

  constructor(rootId = 'root') {
    this.root = new Frame(rootId, null, null);
    this.frames.set(rootId, this.root);
  }

  add(id: string, parentId: string, computeOrigin: OriginFn): Frame {
    const parent = this.frames.get(parentId);
    if (!parent) throw new Error(`Unknown parent frame ${parentId}`);
    if (this.frames.has(id)) throw new Error(`Duplicate frame ${id}`);
    const f = new Frame(id, parent, computeOrigin);
    this.frames.set(id, f);
    this.ordered.push(f);
    return f;
  }

  get(id: string): Frame | undefined {
    return this.frames.get(id);
  }

  require(id: string): Frame {
    const f = this.frames.get(id);
    if (!f) throw new Error(`Unknown frame ${id}`);
    return f;
  }

  update(t: AstroTime): void {
    for (const f of this.ordered) f.computeOrigin?.(t, f.origin);
  }

  /** Vector from point A (frame fa, offset pa) to point B (frame fb, offset pb), metres. */
  difference(fa: Frame, pa: Readonly<Vec3>, fb: Frame, pb: Readonly<Vec3>, out: Vec3 = [0, 0, 0]): Vec3 {
    const a = this.a, b = this.b;
    a[0] = pa[0]; a[1] = pa[1]; a[2] = pa[2];
    b[0] = pb[0]; b[1] = pb[1]; b[2] = pb[2];
    let x: Frame = fa, y: Frame = fb;
    while (x !== y) {
      if (x.depth >= y.depth) {
        a[0] += x.origin[0]; a[1] += x.origin[1]; a[2] += x.origin[2];
        x = x.parent!;
      } else {
        b[0] += y.origin[0]; b[1] += y.origin[1]; b[2] += y.origin[2];
        y = y.parent!;
      }
    }
    out[0] = b[0] - a[0];
    out[1] = b[1] - a[1];
    out[2] = b[2] - a[2];
    return out;
  }
}
