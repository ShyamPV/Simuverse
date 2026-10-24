import { describe, expect, it } from 'vitest';
import { ResolutionGovernor } from './resolution.ts';

const run = (g: ResolutionGovernor, seconds: number, frameMs: number) => {
  let changes = 0;
  for (let t = 0; t < seconds; t += 1 / 60) if (g.update(1 / 60, frameMs)) changes++;
  return changes;
};

describe('ResolutionGovernor', () => {
  it('leaves a fast renderer alone', () => {
    const g = new ResolutionGovernor();
    expect(run(g, 30, 8)).toBe(0);
    expect(g.scale).toBe(1);
  });

  it('ignores short hitches (data streaming in)', () => {
    const g = new ResolutionGovernor();
    run(g, 1, 40);
    run(g, 5, 16.7);
    expect(g.scale).toBe(1);
  });

  it('steps down while frames stay slow, never below the minimum', () => {
    const g = new ResolutionGovernor(0.5);
    run(g, 2, 33);
    expect(g.scale).toBeLessThan(1);
    expect(g.scale).toBeGreaterThanOrEqual(0.75);
    run(g, 30, 50);
    expect(g.scale).toBe(0.5);
  });

  it('climbs back with headroom, and backs off after a failed attempt', () => {
    const g = new ResolutionGovernor();
    run(g, 2, 30); // down to ~0.75
    const low = g.scale;
    run(g, 5.1, 12);
    expect(g.scale).toBeCloseTo(low + 0.1, 5);
    run(g, 1.6, 25); // that was too much: straight back down
    const after = g.scale;
    run(g, 6, 12); // the next attempt now needs 10 s, not 5
    expect(g.scale).toBe(after);
    run(g, 5, 12);
    expect(g.scale).toBeGreaterThan(after);
  });
});
