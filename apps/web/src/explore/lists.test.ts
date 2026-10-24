import type { CatalogEntry } from '@simuverse/data';
import { describe, expect, it } from 'vitest';
import { closest, extremes, featuredOfDay, sortEntries, tonightCandidates } from './lists.ts';

const LY = 9.4607e15;
const e = (p: Partial<CatalogEntry> & { key: string; name: string }): CatalogEntry => ({
  ref: p.key, aliases: [], category: 'star', type: 'Star', rank: 50, ...p,
});

const entries: CatalogEntry[] = [
  e({ key: 'body:moon', name: 'Moon', category: 'solar-system', type: 'Moon of Earth', distanceM: 3.8e8, magnitude: -12, rank: 1, radiusM: 1.7e6 }),
  e({ key: 'body:mars', name: 'Mars', category: 'solar-system', type: 'Planet', distanceM: 2e11, magnitude: 1, rank: 1 }),
  e({ key: 'body:jupiter', name: 'Jupiter', category: 'solar-system', type: 'Planet', distanceM: 6e11, magnitude: -2.5, rank: 1 }),
  e({ key: 'star:1', name: 'Proxima Centauri', distanceM: 4.24 * LY, magnitude: 11, rank: 30, radiusM: 1e8, luminositySun: 0.0017, temperatureK: 3000 }),
  e({ key: 'star:0', name: 'Sirius', distanceM: 8.6 * LY, magnitude: -1.4, rank: 0, radiusM: 1.2e9, luminositySun: 25, temperatureK: 9900 }),
  e({ key: 'star:2', name: 'Betelgeuse', distanceM: 550 * LY, magnitude: 0.5, rank: 10, radiusM: 5e11, luminositySun: 1e5, temperatureK: 3600 }),
  e({ key: 'exop:1:0', name: 'Proxima Cen b', category: 'exoplanet', distanceM: 4.24 * LY, rank: 40, massKg: 6e24, periodDays: 11, extra: [['Orbit', '0.05 AU · in the habitable zone']] }),
  e({ key: 'gal:2', name: 'Andromeda Galaxy', category: 'galaxy', distanceM: 2.5e6 * LY, radiusM: 1e21, magnitude: 3.4, rank: 18, luminositySun: 3e10 }),
  e({ key: 'gal:9', name: 'Faint Galaxy', category: 'galaxy', distanceM: 2e8 * LY, radiusM: 5e20, magnitude: 14, rank: 60, luminositySun: 1e9 }),
  e({ key: 'exotic:gaia-bh1', name: 'Gaia BH1', category: 'black-hole', distanceM: 1560 * LY, massKg: 1.9e31, rank: 15 }),
  e({ key: 'exotic:m87-star', name: 'M87*', category: 'black-hole', distanceM: 5.5e7 * LY, massKg: 1.3e40, rank: 3 }),
];

describe('Explore lists', () => {
  it('sorts by distance, brightness and size, unknowns last', () => {
    expect(sortEntries(entries, 'distance')[0]!.name).toBe('Moon');
    expect(sortEntries(entries, 'brightness')[0]!.name).toBe('Moon');
    expect(sortEntries(entries, 'size')[0]!.name).toBe('Andromeda Galaxy');
    expect(sortEntries(entries, 'brightness').at(-1)!.magnitude).toBeUndefined();
  });

  it('finds the closest object of each kind', () => {
    const c = closest(entries);
    const caption = (name: string) => c.find((x) => x.entry.name === name)?.caption;
    expect(caption('Moon')).toBe('Closest natural object');
    expect(caption('Mars')).toBe('Closest planet right now');
    expect(caption('Proxima Centauri')).toBe('Closest star to the Sun');
    expect(caption('Sirius')).toBe('Closest bright star');
    expect(caption('Gaia BH1')).toBe('Closest known black hole');
    expect(caption('Andromeda Galaxy')).toBe('Closest galaxy');
  });

  it('finds record holders', () => {
    const x = extremes(entries);
    // One object can hold several records, so captions are joined with " · ".
    const holder = (caption: string) => x.find((r) => r.caption.split(' · ').some((c) => c.toLowerCase() === caption.toLowerCase()))?.entry.name;
    expect(holder('Largest star (by estimated radius)')).toBe('Betelgeuse');
    expect(holder('Most massive black hole')).toBe('M87*');
    expect(holder('Most luminous star')).toBe('Betelgeuse');
    expect(holder('Most distant named galaxy')).toBe('Faint Galaxy');
    expect(holder('Most luminous galaxy')).toBe('Andromeda Galaxy');
  });

  it('picks a stable featured object per day', () => {
    const a = featuredOfDay(entries, new Date('2026-10-24T03:00:00Z'));
    expect(a).toBeDefined();
    expect(featuredOfDay(entries, new Date('2026-10-24T22:00:00Z'))).toBe(a);
  });

  it('suggests only things you could actually see tonight', () => {
    const names = tonightCandidates(entries).map((x) => x.name);
    expect(names).toContain('Jupiter');
    expect(names).toContain('Andromeda Galaxy');
    expect(names).not.toContain('Faint Galaxy');
    expect(names).not.toContain('Gaia BH1');
  });
});
