/** Promise-based pool over the tile workers. */

import type { WebNodeData, WebNodeKey } from './cosmicWeb.ts';
import type { OctreeNode, StarTile } from './octree.ts';
import type { TileRequest } from './tiles.worker.ts';

/** Omit that distributes over a union. */
type WithoutId<T> = T extends unknown ? Omit<T, 'reqId'> : never;

type Reply = { reqId: number; ok: true; tile?: StarTile; web?: WebNodeData } | { reqId: number; ok: false; error: string };

export class TileLoader {
  private readonly workers: Worker[];
  private next = 0;
  private reqId = 1;
  private readonly pending = new Map<number, { resolve: (r: Reply) => void }>();

  constructor(size = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 2))) {
    this.workers = Array.from({ length: size }, () => {
      const w = new Worker(new URL('./tiles.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev: MessageEvent<Reply>) => {
        this.pending.get(ev.data.reqId)?.resolve(ev.data);
        this.pending.delete(ev.data.reqId);
      };
      return w;
    });
  }

  private send(msg: WithoutId<TileRequest>): Promise<Reply> {
    const reqId = this.reqId++;
    const worker = this.workers[this.next++ % this.workers.length]!;
    return new Promise((resolve) => {
      this.pending.set(reqId, { resolve });
      worker.postMessage({ ...msg, reqId } as TileRequest);
    });
  }

  async starTile(url: string, node: OctreeNode): Promise<StarTile> {
    const r = await this.send({ type: 'star', url, node });
    if (!r.ok) throw new Error(r.error);
    return r.tile!;
  }

  async webNode(key: WebNodeKey): Promise<WebNodeData> {
    const r = await this.send({ type: 'web', key });
    if (!r.ok) throw new Error(r.error);
    return r.web!;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.pending.clear();
  }
}
