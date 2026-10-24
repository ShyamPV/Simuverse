import { describe, expect, it } from 'vitest';
import { decodeExoplanets } from './exoplanets.ts';

const planet = (name: string, rad: number | null, mass: number | null) =>
  [name, 10, 0.1, 0, 90, null, null, rad, mass, 500, 2010, 'Transit', 'Kepler'] as const;

describe('decodeExoplanets', () => {
  const [sys] = decodeExoplanets({
    systems: [['Kepler-80', 290, 39, 370, 14.8, 'K5 V', 4500, 0.68, 0.73, null, 1, [
      planet('Kepler-80 d', 1.5, 6.8) as never,
      planet('Kepler-80 f', 1.21, 12652) as never,
      planet('Kepler-80 g', null, 30) as never,
    ]]],
  });

  it('keeps plausible masses and drops ones impossible for the measured radius', () => {
    expect(sys!.planets.map((p) => p.massEarth)).toEqual([6.8, null, 30]);
  });

  it('estimates a radius from the mass when none was measured', () => {
    const g = sys!.planets[2]!;
    expect(g.radiusMeasured).toBe(false);
    expect(g.radiusEarth).toBeGreaterThan(1);
  });
});
