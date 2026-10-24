import type { StarBuffers, StarNameEntry } from './starCatalog.ts';

export * from './starCatalog.ts';

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
