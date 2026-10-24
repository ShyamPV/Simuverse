import { describe, expect, it } from 'vitest';
import {
  J2000, astroTimeFromJdTdb, astroTimeFromUnixMs, deltaT, jdFromUnixMs, taiMinusUtc, ttMinusUtc,
} from './time.ts';

const SECOND_IN_DAYS = 1 / 86400;

describe('Julian dates', () => {
  it('maps the Unix epoch and J2000 correctly', () => {
    expect(jdFromUnixMs(0)).toBe(2440587.5);
    expect(jdFromUnixMs(Date.UTC(2000, 0, 1, 12))).toBe(J2000);
  });
});

describe('time scales', () => {
  it('J2000.0 (TT) is 2000-01-01 11:58:55.816 UTC', () => {
    const t = astroTimeFromUnixMs(Date.UTC(2000, 0, 1, 11, 58, 55, 816));
    expect(Math.abs(t.jdTt - J2000)).toBeLessThan(0.001 * SECOND_IN_DAYS);
  });

  it('applies leap seconds at their boundaries', () => {
    expect(taiMinusUtc(Date.UTC(2016, 11, 31, 23, 59, 59))).toBe(36);
    expect(taiMinusUtc(Date.UTC(2017, 0, 1))).toBe(37);
    expect(taiMinusUtc(Date.UTC(1971, 0, 1))).toBeUndefined();
    expect(ttMinusUtc(Date.UTC(2024, 5, 1))).toBeCloseTo(69.184, 6);
  });

  it('uses ΔT before 1972, matching published values', () => {
    // Observed ΔT: 1900 ≈ −2.7 s, 1950 ≈ 29.1 s, 1700 ≈ 8.8 s (Morrison & Stephenson).
    expect(deltaT(1900)).toBeCloseTo(-2.79, 1);
    expect(deltaT(1950)).toBeCloseTo(29.07, 1);
    expect(deltaT(1700)).toBeCloseTo(8.83, 1);
    expect(ttMinusUtc(Date.UTC(1950, 0, 1))).toBeGreaterThan(28);
  });

  it('keeps TDB within 2 ms of TT', () => {
    for (let y = 1990; y < 2030; y += 0.37) {
      const t = astroTimeFromUnixMs(Date.UTC(Math.floor(y), 0, 1) + (y % 1) * 3.15e10);
      expect(Math.abs(t.jdTdb - t.jdTt)).toBeLessThan(0.002 * SECOND_IN_DAYS);
    }
  });

  it('round-trips from a TDB Julian date', () => {
    const jd = 2460000.5;
    expect(Math.abs(astroTimeFromJdTdb(jd).jdTdb - jd)).toBeLessThan(1e-6 * SECOND_IN_DAYS);
  });
});
