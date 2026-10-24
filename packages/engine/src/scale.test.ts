import { describe, expect, it } from 'vitest';
import { AU, GPC, KPC, LY, MPC } from '@simuverse/astro';
import { exposureFor, galaxyMagRef, ladderStep, sceneFogMpc } from './scale.ts';

describe('ladderStep', () => {
  it('climbs from a planet to the Sun, the Galaxy, the Local Group and the universe', () => {
    expect(ladderStep('earth', 3000 * AU, true, true)).toBe('sun');
    expect(ladderStep('earth', 3000 * AU, false, true)).toBeNull();
    expect(ladderStep('sun', 40 * KPC, true, true)).toBe('galaxy');
    expect(ladderStep('galaxy', 3 * MPC, true, false)).toBe('local-group');
    expect(ladderStep('local-group', 200 * MPC, true, false)).toBe('universe');
    expect(ladderStep('universe', 10 * GPC, true, false)).toBeNull();
  });

  it('climbs back down when zooming in, with hysteresis', () => {
    expect(ladderStep('universe', 50 * MPC, false, false)).toBe('local-group');
    expect(ladderStep('local-group', 0.5 * MPC, false, false)).toBe('galaxy');
    expect(ladderStep('galaxy', 10 * KPC, false, false)).toBe('sun');
    // Between the thresholds nothing changes in either direction.
    expect(ladderStep('galaxy', 100 * KPC, true, false)).toBeNull();
    expect(ladderStep('galaxy', 100 * KPC, false, false)).toBeNull();
  });

  it('never re-centres away from a user-chosen object or region', () => {
    expect(ladderStep('virgo', 500 * MPC, true, false)).toBeNull();
    expect(ladderStep('laniakea', 5 * GPC, true, false)).toBeNull();
    expect(ladderStep('gal:12', 5 * GPC, true, false)).toBeNull();
    expect(ladderStep('dso:3', 10 * LY, true, false)).toBeNull();
  });
});

describe('exposureFor', () => {
  it('does nothing inside the Galaxy and grows (capped) beyond it', () => {
    expect(exposureFor(100 * LY).pointMag).toBe(0);
    expect(exposureFor(1 * MPC).pointMag).toBeGreaterThan(8);
    expect(exposureFor(10 * GPC).pointMag).toBe(14);
    expect(exposureFor(10 * GPC).extendedGain).toBeCloseTo(10 ** 1.6, 6);
  });
});

describe('galaxyMagRef', () => {
  it('uses naked-eye photometry near home and tracks the view scale beyond', () => {
    expect(galaxyMagRef(1 * AU, 5.5)).toBe(5.5);
    expect(galaxyMagRef(70 * KPC, 5.5)).toBe(5.5);
    // An L* galaxy at 60 Mpc is m ≈ 12.9; the reference sits 1.5 mag fainter.
    expect(galaxyMagRef(60 * MPC, 5.5)).toBeCloseTo(-21 + 5 * Math.log10(6e6) + 1.5, 6);
    expect(galaxyMagRef(45 * GPC, 5.5)).toBe(26);
  });
});

describe('sceneFogMpc', () => {
  it('scales with the viewing distance and never fogs out the local scene', () => {
    expect(sceneFogMpc(4 * MPC)).toBeCloseTo(48, 6);
    expect(sceneFogMpc(400 * MPC)).toBeGreaterThan(4000);
    expect(sceneFogMpc(10 * KPC)).toBeGreaterThanOrEqual(5);
  });
});
