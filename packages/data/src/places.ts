/** Observer locations: a time-zone-based default and GeoNames city search. */

export interface Place {
  name: string;
  /** Region / state, may be empty. */
  admin: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  lat: number;
  lon: number;
  /** Metres above sea level (GeoNames DEM). */
  elevation: number;
  /** IANA time zone. */
  tz: string;
  population: number;
}

type CityRow = [string, string | 0, string, string, number, number, number, number, string];

const toPlace = (r: CityRow): Place => ({
  name: r[0], admin: r[3], country: r[2], lat: r[4], lon: r[5], population: r[6], elevation: r[7], tz: r[8],
});

/** Greenwich, used when nothing better is known. */
export const FALLBACK_PLACE: Place = {
  name: 'Greenwich', admin: 'England', country: 'GB', lat: 51.4769, lon: -0.0005, elevation: 46, tz: 'Europe/London', population: 0,
};

/** The most populous city in the browser's time zone: a sensible location without asking permission. */
export async function defaultPlaceForTimeZone(baseUrl: string, tz = Intl.DateTimeFormat().resolvedOptions().timeZone): Promise<Place> {
  try {
    const res = await fetch(new URL('tz-default-city.json', baseUrl));
    const map = (await res.json()) as Record<string, CityRow>;
    const row = map[tz];
    return row ? toPlace(row) : FALLBACK_PLACE;
  } catch {
    return FALLBACK_PLACE;
  }
}

let cities: Promise<{ place: Place; key: string }[]> | null = null;

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function loadCities(baseUrl: string) {
  cities ??= fetch(new URL('cities.json', baseUrl))
    .then((r) => r.json() as Promise<{ rows: CityRow[] }>)
    .then(({ rows }) => rows.map((r) => ({ place: toPlace(r), key: fold(`${r[0]} ${r[1] || ''}`) })))
    .catch((e) => {
      cities = null;
      throw e;
    });
  return cities;
}

/** Prefix-first search over city names (diacritics-insensitive), most populous first. */
export async function searchPlaces(baseUrl: string, query: string, limit = 8): Promise<Place[]> {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const all = await loadCities(baseUrl);
  const prefix: Place[] = [], inner: Place[] = [];
  for (const c of all) {
    if (c.key.startsWith(q) || c.key.includes(` ${q}`)) prefix.push(c.place);
    else if (c.key.includes(q)) inner.push(c.place);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...inner].slice(0, limit);
}
