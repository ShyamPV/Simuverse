import { describe, expect, it } from 'vitest';
import { AU, C_MPS, GPC, KM, KPC, LY, MPC, PC, formatDistance, formatSpeed, niceRoundDown } from './units.ts';

describe('constants', () => {
  it('derives the parsec and light-year from IAU definitions', () => {
    expect(PC / AU).toBeCloseTo(206264.806, 3);
    expect(LY / 1e15).toBeCloseTo(9.4607304725808, 10);
    expect(PC / LY).toBeCloseTo(3.26156, 5);
  });
});

describe('formatDistance', () => {
  it.each([
    [500, 'm'],
    [384_400 * KM, 'km'],
    [AU, 'AU'],
    [30 * AU, 'AU'],
    [4.24 * LY, 'ly'],
    [25_000 * LY, 'kly'],
    [2.5e6 * LY, 'Mly'],
    [13.8e9 * LY, 'Gly'],
  ])('%s m → %s', (m, unit) => {
    expect(formatDistance(m).unit).toBe(unit);
  });

  it('supports parsec scales', () => {
    expect(formatDistance(1.3 * PC, 'pc').text).toBe('1.30 pc');
    expect(formatDistance(8.2 * KPC, 'pc').unit).toBe('kpc');
    expect(formatDistance(16.5 * MPC, 'pc').unit).toBe('Mpc');
    expect(formatDistance(4.4 * GPC, 'pc').unit).toBe('Gpc');
  });

  it('formats readable numbers', () => {
    expect(formatDistance(AU).text).toBe('1.00 AU');
    expect(formatDistance(149_597_870_700 * 0.002).text).toBe('299,196 km');
  });
});

describe('formatSpeed', () => {
  it('switches to multiples of c above 1% of c', () => {
    expect(formatSpeed(29_780).text).toBe('29.8 km/s');
    expect(formatSpeed(C_MPS).text).toBe('1.00 c');
    expect(formatSpeed(1500 * C_MPS).text).toBe('1,500 c');
    expect(formatSpeed(2e7 * C_MPS).unit).toBe('c');
  });
});

describe('niceRoundDown', () => {
  it('rounds to 1/2/5 steps', () => {
    expect(niceRoundDown(7.3)).toBe(5);
    expect(niceRoundDown(0.031)).toBeCloseTo(0.02);
    expect(niceRoundDown(1999)).toBe(1000);
    expect(niceRoundDown(2e12)).toBe(2e12);
  });
});
