/** Promise-based client for the sky events worker. */

import type { GeodeticLocation, Target, Tle } from '@simuverse/astro';
import type { SkyEventsRequest, SkyEventsResponse } from './workers/sky.worker.ts';

export type { SkyEventsResponse };

export class SkyEvents {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, (r: SkyEventsResponse) => void>();

  constructor(ephemBaseUrl: string) {
    this.worker = new Worker(new URL('./workers/sky.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<SkyEventsResponse>) => {
      const cb = this.pending.get(ev.data.reqId);
      this.pending.delete(ev.data.reqId);
      cb?.(ev.data);
    };
    this.worker.postMessage({ type: 'init', ephemBaseUrl: new URL(ephemBaseUrl, location.href).href });
  }

  compute(
    loc: GeodeticLocation, startMs: number, targets: { key: string; target: Target }[], includeTwilight = false,
    satellites: { key: string; tle: Tle }[] = [], passHours = 24,
  ): Promise<SkyEventsResponse> {
    const reqId = this.nextId++;
    const req: SkyEventsRequest = {
      type: 'events', reqId, location: loc, startMs, targets, includeTwilight, satellites, passHours,
    };
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve);
      this.worker.postMessage(req);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
