/** Deep-sky (non-galaxy) objects from tools/build-deepsky.mjs (OpenNGC + cluster catalogues). */

export type DeepSkyType = 'OCl' | 'GCl' | 'Cl+N' | 'PN' | 'HII' | 'EmN' | 'Neb' | 'RfN' | 'SNR' | 'DrkN' | '*Ass' | 'Other';

export interface DeepSkyObject {
  id: string;
  name: string;
  aliases: string[];
  type: DeepSkyType;
  /** ICRS degrees. */
  ra: number;
  dec: number;
  /** Apparent major/minor axis, arcmin. */
  majAx: number | null;
  minAx: number | null;
  pa: number | null;
  mag: number | null;
  con: string;
  distPc: number | null;
  distSrc: string | null;
  approx?: boolean;
  messier?: number;
}

export const DEEP_SKY_TYPE_LABEL: Record<DeepSkyType, string> = {
  OCl: 'Open cluster',
  GCl: 'Globular cluster',
  'Cl+N': 'Cluster with nebula',
  PN: 'Planetary nebula',
  HII: 'Emission nebula (H II region)',
  EmN: 'Emission nebula',
  Neb: 'Nebula',
  RfN: 'Reflection nebula',
  SNR: 'Supernova remnant',
  DrkN: 'Dark nebula',
  '*Ass': 'Stellar association',
  Other: 'Deep-sky object',
};

export async function loadDeepSky(baseUrl: string): Promise<DeepSkyObject[]> {
  const res = await fetch(new URL('deepsky.json', baseUrl));
  if (!res.ok) throw new Error(`deepsky: HTTP ${res.status}`);
  return res.json() as Promise<DeepSkyObject[]>;
}
