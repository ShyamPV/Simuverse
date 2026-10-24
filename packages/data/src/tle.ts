/**
 * Two-line element sets for bright satellites. Order of preference:
 *   1. IndexedDB copy younger than MAX_AGE (CelesTrak asks clients not to poll more often);
 *   2. live CelesTrak GP data (CORS-enabled), which is then cached;
 *   3. a stale cached copy;
 *   4. the snapshot bundled at build time (tools/build-sky-data.mjs tle).
 */

import { type Tle, parseTleText } from '@simuverse/astro';
import { readCachedText, writeCachedText } from './cache.ts';

const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php';
const GROUPS = ['stations', 'visual'] as const;
const CACHE_KEY = 'tle:stations+visual';
export const TLE_MAX_AGE_MS = 2 * 3600_000;

export interface TleResult {
  tles: Tle[];
  source: 'cache' | 'celestrak' | 'stale-cache' | 'snapshot';
  fetchedAt: number;
}

function dedupe(tles: Tle[]): Tle[] {
  const seen = new Set<string>();
  return tles.filter((t) => {
    const id = t.line1.slice(2, 7);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function loadTles(snapshotUrl: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<TleResult> {
  const cached = await readCachedText(CACHE_KEY);
  if (cached && now - cached.fetchedAt < TLE_MAX_AGE_MS) {
    return { tles: dedupe(parseTleText(cached.text)), source: 'cache', fetchedAt: cached.fetchedAt };
  }
  try {
    const texts = await Promise.all(
      GROUPS.map(async (g) => {
        const res = await fetchImpl(`${CELESTRAK}?GROUP=${g}&FORMAT=tle`);
        if (!res.ok) throw new Error(`CelesTrak ${g}: HTTP ${res.status}`);
        return res.text();
      }),
    );
    const text = texts.join('\n');
    const tles = dedupe(parseTleText(text));
    if (tles.length === 0) throw new Error('CelesTrak returned no element sets');
    await writeCachedText({ key: CACHE_KEY, text, fetchedAt: now, source: 'celestrak' });
    return { tles, source: 'celestrak', fetchedAt: now };
  } catch {
    if (cached) return { tles: dedupe(parseTleText(cached.text)), source: 'stale-cache', fetchedAt: cached.fetchedAt };
    const res = await fetchImpl(snapshotUrl);
    return { tles: dedupe(parseTleText(await res.text())), source: 'snapshot', fetchedAt: 0 };
  }
}
