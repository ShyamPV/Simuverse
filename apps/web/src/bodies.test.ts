import { describe, expect, it } from 'vitest';
import { formatRate, stepRate } from './bodies.ts';

describe('stepRate', () => {
  it('steps through the ladder and crosses from forward to reverse', () => {
    expect(stepRate(1, 1)).toBe(10);
    expect(stepRate(1, -1)).toBe(-1);
    expect(stepRate(-1, -1)).toBe(-10);
    expect(stepRate(1e6, 1)).toBe(1e6);
    expect(stepRate(-1e6, -1)).toBe(-1e6);
  });

  it('snaps off-ladder rates to the neighbouring step', () => {
    expect(stepRate(50, 1)).toBe(100);
    expect(stepRate(50, -1)).toBe(10);
  });
});

describe('formatRate', () => {
  it('abbreviates large multipliers', () => {
    expect(formatRate(1)).toBe('×1');
    expect(formatRate(1e4)).toBe('×10k');
    expect(formatRate(-1e6)).toBe('−×1M');
  });
});
