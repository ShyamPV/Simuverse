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

/**
 * A sky-registered survey image of an object (tools/build-images.mjs):
 * gnomonic, north up, east left, `fov` degrees across.
 */
export interface ObjectImage {
  name: string;
  kind: 'nebula' | 'cluster' | 'galaxy';
  /** File name under images/photo/ (and images/render/ for nebulae). */
  file: string;
  fov: number;
  survey: string;
  credit: string;
  /** Nebulae: slot in the 16×16 billboard atlas and mean linear brightness of the render texture. */
  slot?: number;
  mean?: number;
  /** Built from an H-alpha map (large nebulae): colours are a palette, not true colour. */
  halpha?: boolean;
}

export interface ImageIndex {
  tile: number;
  atlasCols: number;
  /** Keyed by catalogue designation (OpenNGC id) or galaxy name. */
  objects: Record<string, ObjectImage>;
}

/** The image index, or an empty one if images weren't built. */
export async function loadImageIndex(baseUrl: string): Promise<ImageIndex> {
  try {
    const res = await fetch(new URL('images/index.json', baseUrl));
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as ImageIndex;
  } catch {
    return { tile: 128, atlasCols: 16, objects: {} };
  }
}
