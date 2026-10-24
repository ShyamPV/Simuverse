import { describe, expect, it } from 'vitest';
import { AU, GPC, astroTimeFromUnixMs } from '@simuverse/astro';
import { FrameGraph } from './frames.ts';

describe('FrameGraph', () => {
  const t = astroTimeFromUnixMs(0);

  it('differences points through their lowest common ancestor', () => {
    const g = new FrameGraph();
    g.add('sun', 'root', (_t, o) => { o[0] = 100; o[1] = 0; o[2] = 0; });
    g.add('earth', 'sun', (_t, o) => { o[0] = 10; o[1] = 5; o[2] = 0; });
    g.add('moon', 'earth', (_t, o) => { o[0] = 1; o[1] = 0; o[2] = 0; });
    g.add('mars', 'sun', (_t, o) => { o[0] = 0; o[1] = 20; o[2] = 0; });
    g.update(t);
    expect(g.difference(g.require('moon'), [0, 0, 0], g.require('mars'), [0, 0, 1])).toEqual([-11, 15, 1]);
    expect(g.difference(g.root, [0, 0, 0], g.require('moon'), [0, 0, 0])).toEqual([111, 5, 0]);
  });

  it('keeps sub-metre precision near a body placed gigaparsecs from the root', () => {
    const g = new FrameGraph();
    g.add('far-galaxy', 'root', (_t, o) => { o[0] = 3 * GPC; o[1] = -2 * GPC; o[2] = GPC; });
    g.add('far-star', 'far-galaxy', (_t, o) => { o[0] = 1234.5 * AU; o[1] = 0; o[2] = 0; });
    g.add('far-planet', 'far-star', (_t, o) => { o[0] = AU; o[1] = 0; o[2] = 0; });
    g.update(t);
    // Camera 1.25 m above the planet's "surface" point, expressed in the planet frame.
    const d = g.difference(g.require('far-planet'), [6_371_001.25, 0, 0], g.require('far-planet'), [6_371_000, 0, 0]);
    expect(d[0]).toBe(-1.25);
    // Same point expressed via the star frame: still resolved to well under a metre.
    const d2 = g.difference(g.require('far-star'), [AU + 6_371_001.25, 0, 0], g.require('far-planet'), [6_371_000, 0, 0]);
    expect(Math.abs(d2[0] + 1.25)).toBeLessThan(1e-3);
  });
});
