import { describe, expect, it } from 'vitest';
import { formatAzimuth, formatDec, formatLatLon, formatRa, visibilityClass } from './format.ts';

const DEG = Math.PI / 180;

describe('coordinate formatting', () => {
  it('formats Betelgeuse (RA 88.7929°, Dec +7.4071°)', () => {
    expect(formatRa(88.7929 * DEG)).toBe('05h 55m 10.3s');
    expect(formatDec(7.4071 * DEG)).toBe('+07° 24′ 26″');
  });

  it('wraps RA and handles negative declinations', () => {
    expect(formatRa(-1 * DEG)).toBe('23h 56m 00.0s');
    expect(formatDec(-16.7161 * DEG)).toBe('−16° 42′ 58″');
  });

  it('names azimuths and locations', () => {
    expect(formatAzimuth(244.3 * DEG)).toBe('244.3° WSW');
    expect(formatAzimuth(359.9 * DEG)).toBe('359.9° N');
    expect(formatLatLon(-36.8485, 174.7633)).toBe('36.85° S, 174.76° E');
  });

  it('classifies visibility', () => {
    expect(visibilityClass(-1.4)).toBe('Naked eye');
    expect(visibilityClass(7.8)).toBe('Binoculars');
    expect(visibilityClass(13.7)).toBe('Telescope');
  });
});
