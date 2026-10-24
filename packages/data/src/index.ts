import { type GalaxyCatalog, type GalaxyName, decodeGalaxies } from './galaxies.ts';
import type { OctreeIndex } from './octree.ts';
import type { StarBuffers, StarNameEntry } from './starCatalog.ts';

export * from './starCatalog.ts';
export * from './ephemerisLoader.ts';
export * from './constellations.ts';
export * from './places.ts';
export * from './tle.ts';
export * from './cache.ts';

/** Loads and decodes the bundled bright-star catalogue off the main thread. */
export function loadStarCatalog(baseUrl: string): Promise<StarBuffers> {
  const worker = new Worker(new URL('./stars.worker.ts', import.meta.url), { type: 'module' });
  const url = new URL('stars-hyg.bin', new URL(baseUrl, location.href)).href;
  return new Promise((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<{ ok: true; stars: StarBuffers } | { ok: false; error: string }>) => {
      worker.terminate();
      if (ev.data.ok) resolve(ev.data.stars);
      else reject(new Error(ev.data.error));
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message));
    };
    worker.postMessage({ url });
  });
}

export async function loadStarNames(baseUrl: string): Promise<StarNameEntry[]> {
  const res = await fetch(new URL('stars-hyg-names.json', new URL(baseUrl, location.href)));
  if (!res.ok) throw new Error(`HTTP ${res.status} loading star names`);
  return res.json() as Promise<StarNameEntry[]>;
}

export * from './octree.ts';
export * from './galaxies.ts';
export * from './cosmicWeb.ts';
export * from './deepsky.ts';
export * from './tileLoader.ts';
export * from './exoplanets.ts';
export * from './search.ts';
export * from './facts.ts';
export * from './catalog.ts';
export * from './exotica.ts';
export * from './smallBodies.ts';

export async function loadGalaxyCatalog(baseUrl: string): Promise<{ catalog: GalaxyCatalog; names: GalaxyName[] }> {
  const [bin, names] = await Promise.all([
    fetch(new URL('galaxies.bin', baseUrl)).then((r) => {
      if (!r.ok) throw new Error(`galaxies: HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
    fetch(new URL('galaxy-names.json', baseUrl)).then((r) => r.json() as Promise<GalaxyName[]>),
  ]);
  return { catalog: decodeGalaxies(bin), names };
}

export async function loadStarOctreeIndex(baseUrl: string): Promise<OctreeIndex> {
  const res = await fetch(new URL('stars/index.json', baseUrl));
  if (!res.ok) throw new Error(`star octree: HTTP ${res.status}`);
  return res.json() as Promise<OctreeIndex>;
}
