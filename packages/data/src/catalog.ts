/**
 * The Explore catalogue: one entry shape for every kind of object, and the
 * data-driven parts of each page (observing equipment, best season, and facts
 * generated from the numbers when no curated facts exist).
 */

import type { Fact } from './facts.ts';

export type CatalogCategory =
  | 'solar-system' | 'small-body' | 'star' | 'exoplanet' | 'nebula' | 'cluster' | 'galaxy' | 'black-hole' | 'neutron-star';

export const CATEGORY_LABEL: Record<CatalogCategory, string> = {
  'solar-system': 'Sun, planets & moons',
  'small-body': 'Asteroids & comets',
  star: 'Stars',
  exoplanet: 'Exoplanets',
  nebula: 'Nebulae',
  cluster: 'Star clusters',
  galaxy: 'Galaxies',
  'black-hole': 'Black holes',
  'neutron-star': 'Pulsars & neutron stars',
};

export interface CatalogEntry {
  /** Engine key for travel and selection. */
  key: string;
  /** Stable reference (URLs, favourites). */
  ref: string;
  name: string;
  aliases: string[];
  category: CatalogCategory;
  /** Type line, e.g. "Spiral galaxy", "Red supergiant", "Hot Jupiter". */
  type: string;
  /** From the Sun (or, for Solar System objects, from Earth right now), metres. */
  distanceM?: number;
  radiusM?: number;
  massKg?: number;
  luminositySun?: number;
  temperatureK?: number;
  /** Apparent visual magnitude from Earth. */
  magnitude?: number;
  /** Apparent size, arcminutes (extended objects). */
  sizeArcmin?: number;
  raDeg?: number;
  decDeg?: number;
  constellation?: string;
  discovered?: { year?: number; by: string };
  image?: { url: string; credit: string; fov?: number; halpha?: boolean; round?: boolean };
  /** Planets: orbital period (days); stars and exoplanets: host details etc. */
  periodDays?: number;
  /** Extra numbers shown on the page. */
  extra?: [string, string][];
  /** Prominence, 0 (most) … 100: the default sort and the curated lists. */
  rank: number;
  approximate?: boolean;
}

export type Equipment = 'Naked eye' | 'Binoculars' | 'Small telescope' | 'Large telescope' | 'Not visible by eye or telescope';

/**
 * What it takes to see an object from a reasonably dark site: by magnitude,
 * with extended objects (spread over a large area) needing a step more.
 */
export function equipmentFor(e: Pick<CatalogEntry, 'magnitude' | 'sizeArcmin' | 'category'>): Equipment {
  if (e.category === 'black-hole' || e.category === 'exoplanet' || e.magnitude === undefined) return 'Not visible by eye or telescope';
  const extended = (e.sizeArcmin ?? 0) > 10 && e.category !== 'solar-system';
  const m = e.magnitude + (extended ? 1 : 0);
  if (m <= 5.5) return 'Naked eye';
  if (m <= 8.5) return 'Binoculars';
  if (m <= 12) return 'Small telescope';
  if (m <= 16) return 'Large telescope';
  return 'Not visible by eye or telescope';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The month when an object at this right ascension is opposite the Sun, so
 * highest around midnight (the Sun's RA is 0h at the March equinox and moves
 * about 2h a month).
 */
export function bestMonth(raDeg: number): string {
  const day = 79 + ((((raDeg - 180) % 360) + 360) % 360) / 360 * 365.25;
  const date = new Date(Date.UTC(2025, 0, 1) + day * 86400e3);
  return MONTHS[date.getUTCMonth()]!;
}

const LY = 9.4607e15;
const AU = 1.495978707e11;
const R_EARTH = 6.371e6, R_JUPITER = 6.9911e7, R_SUN = 6.957e8;
const MW_DIAMETER_LY = 100_000;
const COMPUTED = 'Computed from catalogue data';

function fmt(x: number, digits = 2): string {
  if (x >= 1000) return Math.round(x).toLocaleString('en-US');
  return String(Number(x.toPrecision(digits)));
}

/** Facts derived from an entry's numbers (used when nothing is curated, or to add to curated ones). */
export function generatedFacts(e: CatalogEntry, nowYear = new Date().getUTCFullYear()): Fact[] {
  const out: Fact[] = [];
  const d = e.distanceM;
  if (d !== undefined) {
    const ly = d / LY;
    if (e.category === 'solar-system' || e.category === 'small-body') {
      const s = d / 299_792_458;
      out.push({ text: s < 120 ? `Light from ${e.name} takes about ${s.toFixed(0)} seconds to reach us.` : `Light from ${e.name} takes about ${fmt(s / 60)} minutes to reach us${s > 7200 ? ` (${fmt(s / 3600)} hours)` : ''}.`, source: COMPUTED });
    } else if (ly < 5000) {
      out.push({ text: `The light we see from ${e.name} set out about ${fmt(ly, 3)} years ago${ly > 30 && ly < 3000 ? `, around ${Math.round(nowYear - ly)} ${nowYear - ly < 0 ? 'BC' : 'AD'}`.replace(/(-?\d+) BC/, (_, y) => `${Math.abs(Number(y))} BC`) : ''}.`, source: COMPUTED });
    } else if (ly < 1e9) {
      out.push({ text: `Its light has travelled about ${ly < 1e6 ? `${fmt(ly / 1000, 3)} thousand` : `${fmt(ly / 1e6, 3)} million`} years to reach us.`, source: COMPUTED });
    }
  }
  const r = e.radiusM;
  if (r !== undefined && r > 0) {
    if (e.category === 'star' && r > 0.05 * R_SUN) {
      const x = r / R_SUN;
      out.push({ text: x >= 1.5 ? `It is about ${fmt(x)} times the Sun’s diameter${x > 200 ? `: placed at the Sun, it would reach past the orbit of ${x > 1100 ? 'Jupiter' : x > 330 ? 'Mars' : 'Earth'}` : ''}.` : x <= 0.67 ? `It is about ${fmt(x)} times the Sun’s diameter: a small star.` : 'It is roughly the size of the Sun.', source: COMPUTED });
    } else if (e.category === 'exoplanet' || e.category === 'solar-system' || e.category === 'small-body') {
      const xe = r / R_EARTH;
      if (xe > 0.05) out.push({ text: xe > 6 ? `It is about ${fmt(r / R_JUPITER)} times Jupiter’s diameter (${fmt(xe)} Earths).` : xe >= 0.8 && xe <= 1.25 ? 'It is close to Earth’s size.' : `It is about ${fmt(xe)} times Earth’s diameter.`, source: COMPUTED });
    } else if (e.category === 'galaxy') {
      const lyAcross = (2 * r) / LY;
      out.push({ text: `It is about ${fmt(lyAcross, 2)} light-years across, ${lyAcross > MW_DIAMETER_LY ? `${fmt(lyAcross / MW_DIAMETER_LY)} times` : `${Math.round((100 * lyAcross) / MW_DIAMETER_LY)}% of`} the Milky Way’s diameter.`, source: COMPUTED });
    } else if (e.category === 'nebula' || e.category === 'cluster') {
      out.push({ text: `It spans about ${fmt((2 * r) / LY)} light-years.`, source: COMPUTED });
    }
  }
  if (e.luminositySun !== undefined && e.category === 'star') {
    const L = e.luminositySun;
    out.push({ text: L >= 2 ? `It shines about ${fmt(L)} times as brightly as the Sun.` : L < 0.5 ? `It gives out only about ${L < 0.01 ? L.toExponential(1) : fmt(L)} of the Sun’s light.` : 'Its power output is similar to the Sun’s.', source: COMPUTED });
  }
  if (e.temperatureK !== undefined && e.category === 'star') {
    const T = e.temperatureK;
    const colour = T > 10000 ? 'blue-white' : T > 7500 ? 'white' : T > 6000 ? 'yellow-white' : T > 5200 ? 'yellow' : T > 3700 ? 'orange' : 'red';
    out.push({ text: `Its surface is about ${fmt(T, 2)} K, which is why it looks ${colour}.`, source: COMPUTED });
  }
  if (e.category === 'exoplanet' && e.periodDays !== undefined) {
    const p = e.periodDays;
    out.push({ text: p < 2 ? `A year there lasts just ${fmt(p * 24)} hours.` : p > 730 ? `A year there lasts about ${fmt(p / 365.25)} Earth years.` : `A year there lasts ${fmt(p, 3)} days.`, source: COMPUTED });
  }
  if (e.magnitude !== undefined && e.category !== 'exoplanet' && e.category !== 'black-hole') {
    const eq = equipmentFor(e);
    out.push({
      text: eq === 'Naked eye' ? 'It can be seen with the naked eye from a dark site.' : eq === 'Binoculars' ? 'Binoculars will show it from a dark site.' : eq === 'Small telescope' ? 'A small telescope is needed to see it.' : eq === 'Large telescope' ? 'Seeing it takes a large amateur telescope.' : 'It is too faint for amateur telescopes.',
      source: COMPUTED,
    });
  }
  return out;
}
