import { describe, expect, it } from 'vitest';
import fx from './__fixtures__/horizons-observer.json' with { type: 'json' };
import type { SolarBodyId } from './ephemeris.ts';
import { findCrossings, riseSetTransit, twilight } from './riseset.ts';
import { loadTestEphemeris } from './testing.ts';
import { DEG } from './units.ts';

const eph = loadTestEphemeris();
const sites = fx.sites as Record<string, { lon: number; lat: number; heightKm: number }>;

describe('findCrossings', () => {
  it('locates roots of a sine to the requested tolerance', () => {
    const f = (t: number) => Math.sin((t / 1000) * 0.01);
    const c = findCrossings(f, 1, 700_000, 60_000, 10);
    expect(c.map((x) => x.rising)).toEqual([false, true]);
    expect(c[0]!.t).toBeCloseTo(Math.PI * 100_000, -2);
  });
});

describe('rise / set / transit vs JPL Horizons (standard sea-level convention)', () => {
  const day = Date.UTC(2026, 9, 24);
  for (const row of fx.riseSet) {
    it(`${row.body} ${row.kind} at ${row.site}`, () => {
      const s = sites[row.site]!;
      const r = riseSetTransit(eph, { lat: s.lat * DEG, lon: s.lon * DEG, height: s.heightKm * 1000 }, { kind: 'body', id: row.body as SolarBodyId }, day);
      const ours = r[row.kind as 'rise' | 'set' | 'transit'];
      expect(ours).toBeDefined();
      // Reference interpolated from Horizons' 1-minute airless elevations / hour angles.
      expect(Math.abs(ours! - Date.parse(row.utc))).toBeLessThan(20_000);
    });
  }
});

describe('twilight and polar cases', () => {
  it('orders dusk before night for a mid-latitude evening', () => {
    const tw = twilight(eph, { lat: 51.4778 * DEG, lon: 0, height: 0 }, Date.UTC(2026, 9, 24));
    expect(tw.civilDusk! < tw.nauticalDusk! && tw.nauticalDusk! < tw.astronomicalDusk!).toBe(true);
  });

  it('reports the midnight Sun and polar night', () => {
    const svalbard = { lat: 78.22 * DEG, lon: 15.65 * DEG, height: 0 };
    const sun = { kind: 'body' as const, id: 'sun' as const };
    expect(riseSetTransit(eph, svalbard, sun, Date.UTC(2026, 5, 21)).alwaysUp).toBe(true);
    expect(riseSetTransit(eph, svalbard, sun, Date.UTC(2026, 11, 21)).alwaysDown).toBe(true);
  });
});
