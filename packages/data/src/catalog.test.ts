import { describe, expect, it } from 'vitest';
import { type CatalogEntry, bestMonth, equipmentFor, generatedFacts } from './catalog.ts';
import { CURATED_COUNT, curatedInfo } from './facts.ts';

const base = (e: Partial<CatalogEntry>): CatalogEntry => ({
  key: 'x', ref: 'x', name: 'Test', aliases: [], category: 'star', type: 'Star', rank: 50, ...e,
});

describe('catalogue helpers', () => {
  it('chooses equipment by magnitude, penalising large faint objects', () => {
    expect(equipmentFor({ magnitude: -1.4, category: 'star' })).toBe('Naked eye');
    expect(equipmentFor({ magnitude: 7, category: 'star' })).toBe('Binoculars');
    expect(equipmentFor({ magnitude: 4, sizeArcmin: 60, category: 'nebula' })).toBe('Naked eye');
    expect(equipmentFor({ magnitude: 6, sizeArcmin: 60, category: 'nebula' })).toBe('Binoculars');
    expect(equipmentFor({ magnitude: 10.5, category: 'galaxy' })).toBe('Small telescope');
    expect(equipmentFor({ magnitude: 25, category: 'exoplanet' })).toBe('Not visible by eye or telescope');
  });

  it('finds the season an object is best seen', () => {
    expect(bestMonth(83.8)).toBe('December'); // Orion Nebula (RA 5h35m)
    expect(bestMonth(10.7)).toBe('September'); // Andromeda Galaxy (opposite the Sun about 29 September)
    expect(bestMonth(271)).toBe('June'); // Lagoon Nebula
  });

  it('generates facts from numbers', () => {
    const sirius = generatedFacts(base({ name: 'Sirius', distanceM: 8.6 * 9.4607e15, radiusM: 1.7 * 6.957e8, luminositySun: 25, temperatureK: 9940, magnitude: -1.44 }), 2026);
    expect(sirius.map((f) => f.text).join(' ')).toMatch(/8\.6 years ago/);
    expect(sirius.some((f) => /1\.7 times the Sun’s diameter/.test(f.text))).toBe(true);
    expect(sirius.some((f) => /white/.test(f.text))).toBe(true);
    const betelgeuse = generatedFacts(base({ name: 'Betelgeuse', radiusM: 760 * 6.957e8 }), 2026);
    expect(betelgeuse[0]!.text).toMatch(/orbit of Mars/);
    const andromeda = generatedFacts(base({ name: 'M31', category: 'galaxy', distanceM: 2.5e6 * 9.4607e15, radiusM: 1.1e5 * 9.4607e15 }), 2026);
    expect(andromeda.map((f) => f.text).join(' ')).toMatch(/2\.5 million years/);
    const jupiter = generatedFacts(base({ name: 'Jupiter', category: 'solar-system', distanceM: 6.3e11, radiusM: 6.9911e7 }), 2026);
    expect(jupiter[0]!.text).toMatch(/minutes to reach us/);
  });

  it('matches curated facts through any name, ignoring case and accents', () => {
    expect(CURATED_COUNT).toBeGreaterThan(120);
    expect(curatedInfo(['M42'])?.facts.length).toBeGreaterThanOrEqual(2);
    expect(curatedInfo(['nonexistent', 'orion nebula'])).toBe(curatedInfo(['Great Orion Nebula']));
    expect(curatedInfo(['TITAN'])?.discovered).toEqual({ year: 1655, by: 'Christiaan Huygens' });
    for (const name of ['Sun', 'Jupiter', 'Sirius', 'Andromeda Galaxy', 'TRAPPIST-1', 'Sagittarius A*', 'Halley’s Comet']) {
      const info = curatedInfo([name])!;
      expect(info.facts.length, name).toBeGreaterThanOrEqual(1);
      for (const f of info.facts) expect(f.source.length, name).toBeGreaterThan(2);
    }
  });
});
