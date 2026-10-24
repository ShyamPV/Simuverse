/**
 * IndexedDB cache (Dexie) for data fetched from third-party services and for
 * streamed tiles. Every operation degrades to a no-op if IndexedDB is
 * unavailable (private mode, blocked storage), so callers can always fall back
 * to the network.
 */

import Dexie, { type Table } from 'dexie';

export interface CachedText {
  key: string;
  text: string;
  /** Unix ms when fetched. */
  fetchedAt: number;
  source: string;
}

export interface CachedBinary {
  key: string;
  data: ArrayBuffer;
  /** Unix ms when last used, for LRU eviction. */
  usedAt: number;
  bytes: number;
}

/** An object the user starred in the Explore catalogue (keyed by its stable reference). */
export interface Favorite {
  ref: string;
  name: string;
  addedAt: number;
}

/** An object the user has travelled to. */
export interface Visit {
  ref: string;
  name: string;
  lastAt: number;
  count: number;
}

/** Tiles beyond this total are evicted, least recently used first. */
export const TILE_CACHE_BUDGET_BYTES = 200 * 1024 * 1024;

class SimuverseDb extends Dexie {
  texts!: Table<CachedText, string>;
  binaries!: Table<CachedBinary, string>;
  favorites!: Table<Favorite, string>;
  visits!: Table<Visit, string>;

  constructor() {
    super('simuverse');
    this.version(1).stores({ texts: 'key' });
    this.version(2).stores({ texts: 'key', binaries: 'key, usedAt' });
    this.version(3).stores({ texts: 'key', binaries: 'key, usedAt', favorites: 'ref, addedAt', visits: 'ref, lastAt' });
  }
}

let db: SimuverseDb | null | undefined;

function open(): SimuverseDb | null {
  if (db !== undefined) return db;
  try {
    db = typeof indexedDB === 'undefined' ? null : new SimuverseDb();
  } catch {
    db = null;
  }
  return db;
}

export async function readCachedText(key: string): Promise<CachedText | undefined> {
  try {
    return await open()?.texts.get(key);
  } catch {
    return undefined;
  }
}

export async function writeCachedText(entry: CachedText): Promise<void> {
  try {
    await open()?.texts.put(entry);
  } catch {
    // Quota exceeded or storage blocked: the cache is best-effort.
  }
}

export async function readCachedBinary(key: string): Promise<ArrayBuffer | undefined> {
  try {
    const d = open();
    const hit = await d?.binaries.get(key);
    if (hit) void d!.binaries.update(key, { usedAt: Date.now() });
    return hit?.data;
  } catch {
    return undefined;
  }
}

let writesSinceTrim = 0;

export async function writeCachedBinary(key: string, data: ArrayBuffer): Promise<void> {
  try {
    const d = open();
    if (!d) return;
    await d.binaries.put({ key, data, usedAt: Date.now(), bytes: data.byteLength });
    if (++writesSinceTrim >= 50) {
      writesSinceTrim = 0;
      await trimBinaries(d);
    }
  } catch {
    // best-effort
  }
}

async function trimBinaries(d: SimuverseDb): Promise<void> {
  let total = 0;
  const victims: string[] = [];
  // Newest first: keep until the budget is spent, evict the rest.
  await d.binaries.orderBy('usedAt').reverse().each((e) => {
    total += e.bytes;
    if (total > TILE_CACHE_BUDGET_BYTES) victims.push(e.key);
  });
  if (victims.length) await d.binaries.bulkDelete(victims);
}

// ---------------------------------------------------------------- favourites and visits

export async function listFavorites(): Promise<Favorite[]> {
  try {
    return (await open()?.favorites.orderBy('addedAt').reverse().toArray()) ?? [];
  } catch {
    return [];
  }
}

export async function setFavorite(ref: string, name: string, on: boolean): Promise<void> {
  try {
    const d = open();
    if (on) await d?.favorites.put({ ref, name, addedAt: Date.now() });
    else await d?.favorites.delete(ref);
  } catch {
    // Storage blocked: favourites just don't persist.
  }
}

export async function listVisits(limit = 50): Promise<Visit[]> {
  try {
    return (await open()?.visits.orderBy('lastAt').reverse().limit(limit).toArray()) ?? [];
  } catch {
    return [];
  }
}

export async function recordVisit(ref: string, name: string): Promise<void> {
  try {
    const d = open();
    if (!d) return;
    const prev = await d.visits.get(ref);
    await d.visits.put({ ref, name, lastAt: Date.now(), count: (prev?.count ?? 0) + 1 });
  } catch {
    // Best-effort.
  }
}
