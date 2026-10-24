/**
 * Loads DE440 Chebyshev chunks on demand: the 50-year block covering the
 * current simulation date first, then its neighbours in the background.
 * Chunks are zero-copy views over the fetched buffers.
 */

import { EphemerisStore, decodeEphemerisChunk } from '@simuverse/astro';

export interface EphemerisManifest {
  blocks: { file: string; startJd: number; endJd: number; startYear: number; endYear: number; bytes: number }[];
  maxFitErrorKm: Record<string, number>;
}

export class EphemerisLoader {
  readonly store = new EphemerisStore();
  private manifest: Promise<EphemerisManifest>;
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly baseUrl: string) {
    this.manifest = fetch(new URL('manifest.json', baseUrl)).then((r) => {
      if (!r.ok) throw new Error(`Ephemeris manifest: HTTP ${r.status}`);
      return r.json() as Promise<EphemerisManifest>;
    });
  }

  /** Called whenever a chunk finishes loading. */
  onLoad(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Earliest and latest TDB Julian dates with precise coverage. */
  async span(): Promise<[number, number]> {
    const m = await this.manifest;
    return [m.blocks[0]!.startJd, m.blocks.at(-1)!.endJd];
  }

  /** Ensures the block covering jd (and, lazily, its neighbours) is loaded. */
  async ensure(jdTdb: number, prefetchNeighbours = true): Promise<boolean> {
    const m = await this.manifest;
    const idx = m.blocks.findIndex((b) => jdTdb >= b.startJd && jdTdb < b.endJd);
    if (idx < 0) return false;
    await this.load(m.blocks[idx]!.file);
    if (prefetchNeighbours) {
      for (const n of [idx - 1, idx + 1]) {
        const b = m.blocks[n];
        if (b) void this.load(b.file).catch(() => undefined);
      }
    }
    return true;
  }

  private load(file: string): Promise<void> {
    let p = this.inflight.get(file);
    if (!p) {
      p = fetch(new URL(file, this.baseUrl))
        .then((r) => {
          if (!r.ok) throw new Error(`Ephemeris ${file}: HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((buf) => {
          this.store.add(decodeEphemerisChunk(buf));
          for (const cb of this.listeners) cb();
        });
      p.catch(() => this.inflight.delete(file)); // allow retry after a failure
      this.inflight.set(file, p);
    }
    return p;
  }
}
