import { describe, expect, it } from 'vitest';
import {
  NODE_CAPACITY, OBSERVABLE_RADIUS_MPC, WEB_BANDS, WEB_FADE_INNER_MPC, cellNode, cumulativeDensity, generateWebNode,
  selectWebNodes, webNodeCenter,
} from './cosmicWeb.ts';

describe('luminosity function', () => {
  it('integrates to a realistic density of bright galaxies', () => {
    // Galaxies brighter than about L* number a few ×10⁻³ per Mpc³.
    const n = cumulativeDensity(-19);
    expect(n).toBeGreaterThan(1e-3);
    expect(n).toBeLessThan(1e-2);
    expect(cumulativeDensity(-23)).toBeLessThan(cumulativeDensity(-21));
  });

  it('assigns contiguous magnitude bands, brightest at the root', () => {
    for (let d = 1; d < WEB_BANDS.length; d++) expect(WEB_BANDS[d]![0]).toBeCloseTo(WEB_BANDS[d - 1]![1], 9);
    expect(WEB_BANDS[0]![0]).toBeLessThan(WEB_BANDS.at(-1)![1]);
  });
});

describe('procedural structure', () => {
  it('is deterministic', () => {
    expect(cellNode(12, -40, 7)).toEqual(cellNode(12, -40, 7));
    const k = { depth: 6, ix: 40, iy: 33, iz: 31 };
    const a = generateWebNode(k), b = generateWebNode(k);
    expect(a.count).toBe(b.count);
    expect(Array.from(a.positions.slice(0, 30))).toEqual(Array.from(b.positions.slice(0, 30)));
  });

  it('keeps galaxies inside their node, outside the catalogue sphere and within the horizon', () => {
    const k = { depth: 6, ix: 40, iy: 33, iz: 31 };
    const g = generateWebNode(k);
    expect(g.count).toBeGreaterThan(100);
    expect(g.count).toBeLessThanOrEqual(NODE_CAPACITY);
    const c = webNodeCenter(k);
    for (let i = 0; i < g.count; i++) {
      const x = g.positions[i * 3]! + c[0], y = g.positions[i * 3 + 1]! + c[1], z = g.positions[i * 3 + 2]! + c[2];
      const d = Math.hypot(x, y, z);
      expect(d).toBeGreaterThanOrEqual(WEB_FADE_INNER_MPC);
      expect(d).toBeLessThanOrEqual(OBSERVABLE_RADIUS_MPC);
    }
  });

  it('clusters galaxies: most sit near a structure node rather than in the field', () => {
    const g = generateWebNode({ depth: 7, ix: 80, iy: 66, iz: 62 });
    const field = Array.from(g.environment).filter((e) => e === 2).length;
    expect(field / g.count).toBeLessThan(0.15);
  });
});

describe('selectWebNodes', () => {
  it('loads deeper nodes near the camera and respects the budget', () => {
    const near = selectWebNodes([2000, 0, 0], 20, 400_000);
    const depths = near.map((k) => k.depth);
    expect(Math.max(...depths)).toBeGreaterThan(3);
    expect(near.length * NODE_CAPACITY).toBeLessThanOrEqual(400_000 + NODE_CAPACITY);
  });
});
