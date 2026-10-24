import { describe, expect, it } from 'vitest';
import horizons from './__fixtures__/horizons.json' with { type: 'json' };
import { moonGeocentricEcliptic } from './moon.ts';
import { type PlanetId, PLANET_IDS, planetHeliocentric } from './planets.ts';
import { centuriesSinceJ2000 } from './time.ts';
import { DEG } from './units.ts';
import { type Vec3, angleBetween, length } from './vec.ts';

/**
 * Tolerances reflect the stated accuracy of Standish's 1800–2050 element
 * table (largest for Jupiter/Saturn, whose mutual perturbations it ignores).
 */
const MAX_ANGLE_DEG: Record<PlanetId, number> = {
  mercury: 0.02, venus: 0.02, earth: 0.02, mars: 0.03,
  jupiter: 0.2, saturn: 0.3, uranus: 0.1, neptune: 0.05,
};
const MAX_RADIUS_REL = 0.005;

describe('planet positions vs JPL Horizons', () => {
  for (const id of PLANET_IDS) {
    const rows = (horizons.heliocentric as Record<string, { jdTdb: number; r: number[] }[]>)[id]!;
    it.each(rows)(`${id} at JD %#`, ({ jdTdb, r }) => {
      const ref = r as Vec3;
      const p = planetHeliocentric(id, centuriesSinceJ2000(jdTdb));
      expect(angleBetween(p, ref) / DEG).toBeLessThan(MAX_ANGLE_DEG[id]);
      expect(Math.abs(length(p) / length(ref) - 1)).toBeLessThan(MAX_RADIUS_REL);
    });
  }
});

describe('low-precision Moon vs JPL Horizons', () => {
  it.each(horizons.moonGeocentric)('epoch %#', ({ jdTdb, r }) => {
    const ref = r as Vec3;
    const p = moonGeocentricEcliptic(centuriesSinceJ2000(jdTdb));
    expect(angleBetween(p, ref) / DEG).toBeLessThan(0.5);
    expect(Math.abs(length(p) / length(ref) - 1)).toBeLessThan(0.01);
  });
});
