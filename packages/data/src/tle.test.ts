import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { TLE_MAX_AGE_MS, loadTles } from './tle.ts';

const ISS = `ISS (ZARYA)
1 25544U 98067A   26296.69304404  .00008515  00000+0  16237-3 0  9995
2 25544  51.6336  24.1765 0006871 300.7285  59.3026 15.49021515591674
`;
const ok = (text: string) => Promise.resolve(new Response(text, { status: 200 }));

describe('loadTles', () => {
  it('fetches live data, caches it, and serves the cache while fresh', async () => {
    const t0 = 1_000_000;
    const live = vi.fn(() => ok(ISS));
    const first = await loadTles('snap', live as unknown as typeof fetch, t0);
    expect(first.source).toBe('celestrak');
    expect(first.tles).toHaveLength(1); // both groups returned the ISS; deduplicated
    expect(live).toHaveBeenCalledTimes(2);

    const second = await loadTles('snap', live as unknown as typeof fetch, t0 + 60_000);
    expect(second.source).toBe('cache');
    expect(live).toHaveBeenCalledTimes(2);

    // Expired cache + network failure → stale cache rather than nothing.
    const failing = vi.fn(() => Promise.resolve(new Response('', { status: 503 })));
    const third = await loadTles('snap', failing as unknown as typeof fetch, t0 + TLE_MAX_AGE_MS + 1);
    expect(third.source).toBe('stale-cache');
    expect(third.tles[0]!.name).toBe('ISS (ZARYA)');
  });
});
