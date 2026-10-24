/// <reference lib="webworker" />
/**
 * Tile worker: fetches (with an IndexedDB cache) and decodes star-octree tiles,
 * and generates procedural cosmic-web nodes. Results are posted back with
 * their typed arrays transferred, so the main thread never parses or loops.
 */

import { readCachedBinary, writeCachedBinary } from './cache.ts';
import { generateWebNode, type WebNodeKey } from './cosmicWeb.ts';
import { type OctreeNode, decodeStarTile } from './octree.ts';

export type TileRequest =
  | { type: 'star'; reqId: number; url: string; node: OctreeNode }
  | { type: 'web'; reqId: number; key: WebNodeKey };

const scope = self as unknown as DedicatedWorkerGlobalScope;

async function fetchCached(url: string): Promise<ArrayBuffer> {
  const hit = await readCachedBinary(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  void writeCachedBinary(url, buf.slice(0));
  return buf;
}

scope.onmessage = async (ev: MessageEvent<TileRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'star') {
      const tile = decodeStarTile(await fetchCached(msg.url), msg.node);
      scope.postMessage({ reqId: msg.reqId, ok: true, tile }, [
        tile.positions.buffer, tile.absMag.buffer, tile.colors.buffer, tile.bv.buffer, tile.ids.buffer,
      ]);
    } else {
      const web = generateWebNode(msg.key);
      scope.postMessage({ reqId: msg.reqId, ok: true, web }, [
        web.positions.buffer, web.absMag.buffer, web.environment.buffer,
      ]);
    }
  } catch (err) {
    scope.postMessage({ reqId: msg.reqId, ok: false, error: String(err) });
  }
};
