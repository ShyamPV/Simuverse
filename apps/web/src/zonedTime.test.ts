import { describe, expect, it } from 'vitest';
import { fromZonedInput, localMidnight, toZonedInput, tonightStart, zoneOffsetMs, zonedToUtc } from './zonedTime.ts';

describe('zoned time', () => {
  it('knows DST offsets', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15), 'Pacific/Auckland')).toBe(13 * 3600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15), 'Pacific/Auckland')).toBe(12 * 3600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15), 'America/New_York')).toBe(-4 * 3600_000);
  });

  it('converts wall-clock times to UTC and back', () => {
    const t = zonedToUtc(2026, 10, 24, 21, 30, 'Pacific/Auckland');
    expect(new Date(t).toISOString()).toBe('2026-10-24T08:30:00.000Z');
    expect(toZonedInput(t, 'Pacific/Auckland')).toBe('2026-10-24T21:30');
    expect(fromZonedInput('2026-10-24T21:30', 'Pacific/Auckland')).toBe(t);
  });

  it('finds local midnight and the start of tonight', () => {
    const t = Date.UTC(2026, 9, 24, 14, 0); // 03:00 on the 25th in Auckland (NZDT)
    expect(new Date(localMidnight(t, 'Pacific/Auckland')).toISOString()).toBe('2026-10-24T11:00:00.000Z');
    // 03:00 belongs to the night that began on the 24th.
    expect(new Date(tonightStart(t, 'Pacific/Auckland')).toISOString()).toBe('2026-10-23T23:00:00.000Z');
  });
});
