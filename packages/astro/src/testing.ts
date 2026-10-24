/** Test helper: loads the bundled DE440 chunks from disk into an Ephemeris. */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EphemerisStore, decodeEphemerisChunk } from './chebyshev.ts';
import { Ephemeris } from './ephemeris.ts';

const dir = fileURLToPath(new URL('../../../apps/web/public/data/ephem/', import.meta.url));

export function loadTestEphemeris(): Ephemeris {
  const store = new EphemerisStore();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.bin'))) {
    const b = readFileSync(dir + f);
    store.add(decodeEphemerisChunk(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  return new Ephemeris(store);
}
