/// <reference lib="webworker" />
import { decodeStarCatalog } from './starCatalog.ts';

export interface StarWorkerRequest {
  url: string;
}

self.onmessage = async (ev: MessageEvent<StarWorkerRequest>) => {
  try {
    const res = await fetch(ev.data.url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${ev.data.url}`);
    const stars = decodeStarCatalog(await res.arrayBuffer());
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: true, stars }, [
      stars.positions.buffer,
      stars.absMag.buffer,
      stars.colors.buffer,
      stars.bv.buffer,
      stars.flags.buffer,
    ]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
