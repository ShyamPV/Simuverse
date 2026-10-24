import { describe, expect, it, vi } from 'vitest';
import { MAX_SIM_MS, TimeController } from './TimeController.ts';

function controller(startMs = Date.UTC(2026, 0, 1)) {
  let wall = 0;
  const tc = new TimeController(startMs, () => wall);
  return { tc, advance: (ms: number) => (wall += ms) };
}

describe('TimeController', () => {
  it('runs at the configured rate, including reverse', () => {
    const { tc, advance } = controller(1_000_000);
    advance(1000);
    expect(tc.nowMs()).toBe(1_001_000);
    tc.setRate(-3600);
    advance(1000);
    expect(tc.nowMs()).toBe(1_001_000 - 3_600_000);
  });

  it('holds time while paused and resumes from the same instant', () => {
    const { tc, advance } = controller(5000);
    tc.setPaused(true);
    advance(10_000);
    expect(tc.nowMs()).toBe(5000);
    tc.setPaused(false);
    advance(1000);
    expect(tc.nowMs()).toBe(6000);
  });

  it('clamps to the supported ephemeris span', () => {
    const { tc, advance } = controller(MAX_SIM_MS - 1000);
    tc.setRate(1e6);
    advance(1000);
    expect(tc.nowMs()).toBe(MAX_SIM_MS);
  });

  it('notifies listeners once per change', () => {
    const { tc } = controller();
    const cb = vi.fn();
    const off = tc.onChange(cb);
    tc.setRate(10);
    tc.resetToNow();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(tc.rate).toBe(1);
    off();
    tc.setPaused(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
