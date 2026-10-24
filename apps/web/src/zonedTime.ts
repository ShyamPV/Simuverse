/**
 * Wall-clock time in an arbitrary IANA time zone (the observer's, which may
 * differ from the browser's), using only Intl — no tz database bundled.
 */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of an instant in a zone. */
export function zonedParts(ms: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/** Zone offset from UTC at an instant, ms (e.g. +13 h for Auckland in summer). */
export function zoneOffsetMs(ms: number, tz: string): number {
  const z = zonedParts(ms, tz);
  const asUtc = Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant for a wall-clock time in a zone (DST gaps resolve forward). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - zoneOffsetMs(guess, tz);
  t = guess - zoneOffsetMs(t, tz);
  return t;
}

/** Value for <input type="datetime-local"> showing the instant in a zone. */
export function toZonedInput(ms: number, tz: string): string {
  const z = zonedParts(ms, tz);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(z.y, 4)}-${pad(z.mo)}-${pad(z.d)}T${pad(z.h)}:${pad(z.mi)}`;
}

/** Parses a datetime-local value as wall-clock time in a zone. */
export function fromZonedInput(value: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return zonedToUtc(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, tz);
}

/** Start of the local calendar day containing ms. */
export function localMidnight(ms: number, tz: string): number {
  const z = zonedParts(ms, tz);
  return zonedToUtc(z.y, z.mo, z.d, 0, 0, tz);
}

/** Start of "tonight": local noon of the day whose night contains (or follows) ms. */
export function tonightStart(ms: number, tz: string): number {
  const z = zonedParts(ms - 12 * 3600_000, tz);
  return zonedToUtc(z.y, z.mo, z.d, 12, 0, tz);
}

export function formatTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(ms);
}

export function zoneAbbreviation(ms: number, tz: string): string {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms);
  return p.find((x) => x.type === 'timeZoneName')?.value ?? tz;
}

export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
