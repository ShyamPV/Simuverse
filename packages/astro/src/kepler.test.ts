import { describe, expect, it } from 'vitest';
import { elementsToPosition, sampleOrbit, solveKepler, stateToElements } from './kepler.ts';
import { length } from './vec.ts';

describe('solveKepler', () => {
  it.each([0, 0.0167, 0.2056, 0.6, 0.97])('satisfies M = E − e sin E for e = %s', (e) => {
    for (let M = -3.1; M <= 3.1; M += 0.37) {
      const E = solveKepler(M, e);
      expect(E - e * Math.sin(E)).toBeCloseTo(M, 12);
    }
  });
});

describe('stateToElements', () => {
  const mu = 1.32712440018e11; // km³/s², Sun

  it.each([
    { a: 1.5e8, e: 0.0167, i: 0.0001, node: 0.2, argPeri: 1.8, M: 0.4 },
    { a: 7.8e8, e: 0.048, i: 0.0228, node: 1.75, argPeri: 4.78, M: 2.9 },
    { a: 5.9e9, e: 0.2488, i: 0.2994, node: 1.925, argPeri: 1.98, M: -1.1 },
  ])('round-trips elements through a state vector (a = %s)', (el) => {
    // Velocity by differentiating position along the orbit (dM = n dt).
    const n = Math.sqrt(mu / el.a ** 3);
    const dt = 10;
    const r = elementsToPosition(el);
    const r2 = elementsToPosition({ ...el, M: el.M + n * dt });
    const r1 = elementsToPosition({ ...el, M: el.M - n * dt });
    const v: [number, number, number] = [(r2[0] - r1[0]) / (2 * dt), (r2[1] - r1[1]) / (2 * dt), (r2[2] - r1[2]) / (2 * dt)];
    const back = stateToElements(r, v, mu);
    expect(back.a / el.a).toBeCloseTo(1, 6);
    expect(back.e).toBeCloseTo(el.e, 6);
    // The reconstructed ellipse must pass through the same point.
    const p = elementsToPosition(back);
    expect(Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2]) / length(r)).toBeLessThan(1e-7);
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
