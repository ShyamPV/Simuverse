import { type CatalogCategory, type CatalogEntry, equipmentFor } from '@simuverse/data';
import { curatedInfo } from '@simuverse/data/facts';

export type SortKey = 'relevance' | 'name' | 'distance' | 'brightness' | 'size';

export const SORT_LABEL: Record<SortKey, string> = {
  relevance: 'Most notable', name: 'Name', distance: 'Nearest first', brightness: 'Brightest first', size: 'Largest first',
};

export function sortEntries(entries: CatalogEntry[], key: SortKey): CatalogEntry[] {
  const out = entries.slice();
  const last = (v: number | undefined, dir = 1) => (v === undefined || !Number.isFinite(v) ? Infinity : v * dir);
  switch (key) {
    case 'name': return out.sort((a, b) => a.name.localeCompare(b.name));
    case 'distance': return out.sort((a, b) => last(a.distanceM) - last(b.distanceM));
    case 'brightness': return out.sort((a, b) => last(a.magnitude) - last(b.magnitude));
    case 'size': return out.sort((a, b) => last(a.radiusM, -1) - last(b.radiusM, -1));
    default: return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }
}

export function filterCategory(entries: CatalogEntry[], category: CatalogCategory | null): CatalogEntry[] {
  return category ? entries.filter((e) => e.category === category) : entries;
}

/** A different notable object each day, the same for everyone on that date. */
export function featuredOfDay(entries: CatalogEntry[], date: Date): CatalogEntry | undefined {
  const pool = entries
    .filter((e) => e.rank < 30 && e.key !== 'body:earth' && curatedInfo([e.name, ...e.aliases]))
    .sort((a, b) => a.ref.localeCompare(b.ref));
  if (!pool.length) return undefined;
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400e3);
  // Multiplicative hash so consecutive days jump around the list.
  return pool[(Math.imul(day, 2654435761) >>> 0) % pool.length];
}

/** The nearest object of each kind (and the nearest few planets and stars). */
export function closest(entries: CatalogEntry[]): { entry: CatalogEntry; caption: string }[] {
  const withDist = entries.filter((e) => e.distanceM !== undefined && e.key !== 'body:earth' && e.key !== 'body:sun');
  const by = (pred: (e: CatalogEntry) => boolean) => withDist.filter(pred).sort((a, b) => a.distanceM! - b.distanceM!);
  const out: { entry: CatalogEntry; caption: string }[] = [];
  const add = (e: CatalogEntry | undefined, caption: string) => {
    if (e && !out.some((o) => o.entry.key === e.key)) out.push({ entry: e, caption });
  };
  add(by((e) => e.key === 'body:moon')[0], 'Closest natural object');
  add(by((e) => e.category === 'solar-system' && e.type === 'Planet')[0], 'Closest planet right now');
  add(by((e) => e.category === 'small-body')[0], 'Closest asteroid or comet in the catalogue right now');
  const stars = by((e) => e.category === 'star');
  add(stars[0], 'Closest star to the Sun');
  add(stars.find((e) => e.magnitude !== undefined && e.magnitude < 3 && e !== stars[0] && !/Cen/.test(e.name)), 'Closest bright star');
  add(by((e) => e.category === 'exoplanet')[0], 'Closest known exoplanet');
  add(by((e) => e.category === 'exoplanet' && (e.extra ?? []).some(([, v]) => /habitable/.test(v)))[0], 'Closest exoplanet in a habitable zone');
  add(by((e) => e.category === 'cluster')[0], 'Closest star cluster');
  add(by((e) => e.category === 'nebula' && !e.approximate)[0], 'Closest nebula with a measured distance');
  add(by((e) => e.category === 'black-hole')[0], 'Closest known black hole');
  add(by((e) => e.category === 'neutron-star')[0], 'Closest known neutron star');
  add(by((e) => e.category === 'galaxy')[0], 'Closest galaxy');
  add(by((e) => e.category === 'galaxy' && (e.radiusM ?? 0) > 3e20)[0], 'Closest large galaxy');
  return out;
}

/** Record holders in the catalogue. */
export function extremes(entries: CatalogEntry[]): { entry: CatalogEntry; caption: string }[] {
  const out: { entry: CatalogEntry; caption: string }[] = [];
  const max = (pred: (e: CatalogEntry) => boolean, val: (e: CatalogEntry) => number | undefined, caption: string, min = false) => {
    let best: CatalogEntry | undefined, bv = min ? Infinity : -Infinity;
    for (const e of entries) {
      if (!pred(e)) continue;
      const v = val(e);
      if (v === undefined || !Number.isFinite(v)) continue;
      if (min ? v < bv : v > bv) { bv = v; best = e; }
    }
    if (!best) return;
    // One object can hold several records (largest and most luminous star): one row, both captions.
    const existing = out.find((o) => o.entry.key === best!.key);
    if (existing) existing.caption += ` · ${caption.charAt(0).toLowerCase()}${caption.slice(1)}`;
    else out.push({ entry: best, caption });
  };
  const measuredStar = (e: CatalogEntry) => e.category === 'star' && !e.approximate;
  max(measuredStar, (e) => e.radiusM, 'Largest star (by estimated radius)');
  max(measuredStar, (e) => e.luminositySun, 'Most luminous star');
  max(measuredStar, (e) => e.temperatureK, 'Hottest star');
  max((e) => e.category === 'exoplanet', (e) => e.massKg, 'Most massive exoplanet');
  max((e) => e.category === 'exoplanet', (e) => e.temperatureK, 'Hottest exoplanet');
  max((e) => e.category === 'exoplanet', (e) => e.periodDays, 'Shortest year of any exoplanet', true);
  max((e) => e.category === 'black-hole', (e) => e.massKg, 'Most massive black hole');
  max((e) => e.category === 'neutron-star', (e) => {
    const p = (e.extra ?? []).find(([k]) => k === 'Spin period')?.[1];
    return p?.endsWith(' ms') ? -Number(p.slice(0, -3)) : undefined;
  }, 'Fastest-spinning pulsar');
  // (Galaxy sizes are capped in the catalogue, so “largest” would be a tie; luminosity isn't.)
  max((e) => e.category === 'galaxy', (e) => e.luminositySun, 'Most luminous galaxy');
  max((e) => e.category === 'galaxy', (e) => e.distanceM, 'Most distant named galaxy');
  max((e) => e.category === 'nebula' && !e.approximate, (e) => e.radiusM, 'Largest nebula with a measured distance');
  max((e) => e.category === 'solar-system' && e.type.startsWith('Moon'), (e) => e.radiusM, 'Largest moon');
  max((e) => e.category === 'small-body', (e) => e.distanceM, 'Most distant small body in the catalogue right now');
  return out;
}

/** Objects worth checking for tonight: naked eye to small telescope, and notable. */
export function tonightCandidates(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((e) => {
    if (e.key === 'body:earth' || e.key === 'body:sun') return false;
    const eq = equipmentFor(e);
    if (eq === 'Not visible by eye or telescope' || eq === 'Large telescope') return false;
    return e.category === 'solar-system' || e.category === 'small-body' ? (e.magnitude ?? 99) < 11 : e.rank < 40;
  }).slice(0, 600);
}
