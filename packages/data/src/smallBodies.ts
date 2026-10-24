/** Asteroids, dwarf planets and comets from the JPL Small-Body Database (tools/build-smallbodies.mjs). */

export type SmallBodyKind = 'dwarf-planet' | 'tno' | 'asteroid' | 'comet' | 'interstellar';

export interface SmallBody {
  des: string;
  name: string;
  kind: SmallBodyKind;
  fullname: string;
  orbitClass: string | null;
  neo: boolean;
  pha: boolean;
  epochJd: number;
  e: number;
  q: number;
  a: number | null;
  i: number;
  node: number;
  peri: number;
  ma: number | null;
  tp: number;
  periodDays: number | null;
  diameterKm: number | null;
  extentKm: string | null;
  albedo: number | null;
  rotationH: number | null;
  gm: number | null;
  H: number | null;
  G: number | null;
  M1: number | null;
  K1: number | null;
  discovered: string | null;
  discoverer: string | null;
  discoverySite: string | null;
  diameterSource?: string;
}

export async function loadSmallBodies(baseUrl: string): Promise<SmallBody[]> {
  const res = await fetch(new URL('smallbodies.json', new URL(baseUrl, location.href)));
  if (!res.ok) throw new Error(`smallbodies.json: ${res.status}`);
  return ((await res.json()) as { bodies: SmallBody[] }).bodies;
}
