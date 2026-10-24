/// <reference lib="webworker" />
/**
 * Event searches (rise/set/transit, twilight, Moon phase, satellite passes) run here: each
 * needs hundreds of apparent-place evaluations, which would otherwise cost
 * frames. The worker keeps its own ephemeris store, filled from the same
 * cached chunk files as the main thread.
 */

import {
  Ephemeris, EphemerisStore, type GeodeticLocation, type RiseSetTransit, type SatellitePass, type Target, type Tle,
  type Twilight, astroTimeFromUnixMs, createSatellite, decodeEphemerisChunk, jdFromUnixMs, moonPhase, observerState,
  riseSetTransit, satellitePasses, twilight,
} from '@simuverse/astro';

export interface SkyEventsRequest {
  type: 'events';
  reqId: number;
  location: GeodeticLocation;
  /** Start of the 24 h window, UTC ms (usually local midnight at the observer). */
  startMs: number;
  targets: { key: string; target: Target }[];
  includeTwilight: boolean;
  /** Satellites to predict passes for, over `passHours` from startMs. */
  satellites?: { key: string; tle: Tle }[];
  passHours?: number;
}

export interface SkyEventsResponse {
  reqId: number;
  results: Record<string, RiseSetTransit>;
  passes: Record<string, SatellitePass[]>;
  twilight?: Twilight;
  moon?: { name: string; illuminated: number; fraction: number };
  /** False if part of the window fell outside the DE440 span (approximate). */
  precise: boolean;
  error?: string;
}

interface Manifest { blocks: { file: string; startJd: number; endJd: number }[] }

let baseUrl = '';
let manifest: Promise<Manifest> | null = null;
const store = new EphemerisStore();
const eph = new Ephemeris(store);
const loaded = new Set<string>();

async function ensure(jdStart: number, jdEnd: number): Promise<void> {
  const m = await manifest!;
  await Promise.all(
    m.blocks
      .filter((b) => b.endJd > jdStart && b.startJd < jdEnd && !loaded.has(b.file))
      .map(async (b) => {
        const res = await fetch(new URL(b.file, baseUrl));
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${b.file}`);
        store.add(decodeEphemerisChunk(await res.arrayBuffer()));
        loaded.add(b.file);
      }),
  );
}

self.onmessage = async (ev: MessageEvent<{ type: 'init'; ephemBaseUrl: string } | SkyEventsRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    baseUrl = msg.ephemBaseUrl;
    manifest = fetch(new URL('manifest.json', baseUrl)).then((r) => r.json() as Promise<Manifest>);
    return;
  }
  const reply: SkyEventsResponse = { reqId: msg.reqId, results: {}, passes: {}, precise: true };
  try {
    const j0 = jdFromUnixMs(msg.startMs);
    await ensure(j0 - 1, j0 + 2);
    reply.precise = store.covers(j0) && store.covers(j0 + 1);
    for (const { key, target } of msg.targets) {
      reply.results[key] = riseSetTransit(eph, msg.location, target, msg.startMs);
    }
    for (const { key, tle } of msg.satellites ?? []) {
      const sat = createSatellite(tle);
      if (sat) reply.passes[key] = satellitePasses(eph, sat, msg.location, msg.startMs, msg.passHours ?? 24);
    }
    if (msg.includeTwilight) {
      reply.twilight = twilight(eph, msg.location, msg.startMs);
      const obs = observerState(eph, astroTimeFromUnixMs(msg.startMs + 43_200_000), msg.location);
      reply.moon = moonPhase(eph, obs);
    }
  } catch (err) {
    reply.error = String(err);
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);
};
