import { describe, expect, it } from 'vitest';
import { limitingMagnitude } from './skyBrightness.ts';

describe('limitingMagnitude', () => {
  it('hides all but the brightest objects in daylight', () => {
    expect(limitingMagnitude(30)).toBe(-4);
  });
  it('rises through twilight and reaches the dark-sky limit after astronomical dusk', () => {
    expect(limitingMagnitude(-6)).toBeCloseTo(1.5);
    expect(limitingMagnitude(-9)).toBeCloseTo(3);
    expect(limitingMagnitude(-18, 6.2)).toBeCloseTo(6.2);
    expect(limitingMagnitude(-40, 6.2)).toBe(6.2);
  });
  it('is monotonic in Sun altitude', () => {
    let prev = Infinity;
    for (let a = 10; a >= -30; a -= 0.5) {
      const m = limitingMagnitude(a);
      expect(m).toBeGreaterThanOrEqual(prev === Infinity ? m : prev);
      prev = m;
    }
  });
});
