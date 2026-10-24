import { describe, expect, it } from 'vitest';
import { type OctreeIndex, decodeStarTile, distanceToBox, selectOctreeNodes } from './octree.ts';

// Root (bright giants) with two children: a nearby box and a far one.
const index: OctreeIndex = {
  version: 1, capacity: 4, halfSize: 1000, count: 12,
  nodes: [
    { c: [0, 0, 0], h: 1000, n: 4, minM: -5, maxM: -2, k: [1, 2] },
    { c: [-500, -500, -500], h: 500, n: 4, minM: 2, maxM: 6, k: [] }, // contains the Sun-side camera
    { c: [500, 500, 500], h: 500, n: 4, minM: 2, maxM: 6, k: [] },
  ],
};

describe('distanceToBox', () => {
  it('is zero inside and Euclidean outside', () => {
    expect(distanceToBox([0, 0, 0], [0, 0, 0], 1)).toBe(0);
    expect(distanceToBox([3, 0, 0], [0, 0, 0], 1)).toBe(2);
    expect(distanceToBox([2, 2, 0], [0, 0, 0], 1)).toBeCloseTo(Math.SQRT2);
  });
});

describe('selectOctreeNodes', () => {
  it('always includes the root and loads nearby faint nodes before far ones', () => {
    const cam = [-990, -990, -990];
    // Near child: distance ~0 → best mag = 2 + 5log10(1/10) = −3. Far child: ~ 2 + 5log10(~10.0) ≈ 15.0
    const sel = selectOctreeNodes(index, cam, 8, 1e6).map((s) => s.id);
    expect(sel).toContain(0);
    expect(sel).toContain(1);
    expect(sel).not.toContain(2);
  });

  it('respects the star budget', () => {
    const sel = selectOctreeNodes(index, [0, 0, 0], 30, 8).map((s) => s.id);
    expect(sel).toHaveLength(2);
  });
});

describe('decodeStarTile', () => {
  it('round-trips quantised positions to within the quantisation step', () => {
    const node = { c: [100, 0, 0] as [number, number, number], h: 50, n: 1, minM: 1, maxM: 1, k: [] };
    const buf = new ArrayBuffer(16 + 14);
    const v = new DataView(buf);
    'SVT1'.split('').forEach((ch, i) => v.setUint8(i, ch.charCodeAt(0)));
    v.setUint32(4, 1, true);
    // Star at centre + (25, 0, 0) along ICRS x (which is also ecliptic x).
    v.setUint16(16, Math.round((75 / 100) * 65535), true);
    v.setUint16(18, 32768, true);
    v.setUint16(20, 32768, true);
    v.setInt16(22, 4830, true);
    v.setUint8(24, Math.round((0.65 + 0.5) * 70));
    v.setUint32(26, 123456, true);
    const t = decodeStarTile(buf, node);
    expect(t.count).toBe(1);
    expect(t.positions[0]).toBeCloseTo(25, 2);
    expect(Math.abs(t.positions[1]!)).toBeLessThan(0.01);
    expect(t.absMag[0]).toBeCloseTo(4.83, 3);
    expect(t.ids[0]).toBe(123456);
  });
});
