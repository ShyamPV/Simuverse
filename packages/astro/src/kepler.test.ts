import { describe, expect, it } from 'vitest';
import { elementsToPosition, sampleOrbit, solveKepler } from './kepler.ts';
import { length } from './vec.ts';

describe('solveKepler', () => {
  it.each([0, 0.0167, 0.2056, 0.6, 0.97])('satisfies M = E − e sin E for e = %s', (e) => {
    for (let M = -3.1; M <= 3.1; M += 0.37) {
      const E = solveKepler(M, e);
      expect(E - e * Math.sin(E)).toBeCloseTo(M, 12);
    }
  });
});

describe('elementsToPosition', () => {
  it('places perihelion at a(1−e) and aphelion at a(1+e)', () => {
    const base = { a: 2, e: 0.3, i: 0.4, node: 1.1, argPeri: 0.7 };
    expect(length(elementsToPosition({ ...base, M: 0 }))).toBeCloseTo(1.4, 12);
    expect(length(elementsToPosition({ ...base, M: Math.PI }))).toBeCloseTo(2.6, 12);
  });

  it('starts sampled orbits at the body position', () => {
    const el = { a: 1, e: 0.1, i: 0.2, node: 0.3, argPeri: 0.4, M: 1.234 };
    const [first] = sampleOrbit(el, 64);
    const p = elementsToPosition(el);
    expect(first![0]).toBeCloseTo(p[0], 12);
    expect(first![1]).toBeCloseTo(p[1], 12);
    expect(first![2]).toBeCloseTo(p[2], 12);
  });
});
