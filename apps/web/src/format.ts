/** Display formatting for sky coordinates. Angles are radians in, strings out. */

const TAU = 2 * Math.PI;

/** Right ascension as "05h 55m 10.3s". */
export function formatRa(rad: number): string {
  let s = (((rad % TAU) + TAU) % TAU) * (12 / Math.PI) * 3600;
  s = Math.round(s * 10) / 10;
  if (s >= 86400) s -= 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${sec.toFixed(1).padStart(4, '0')}s`;
}

/** Declination as "+07° 24′ 25″". */
export function formatDec(rad: number): string {
  const sign = rad < 0 ? '−' : '+';
  let s = Math.round(Math.abs(rad) * (180 / Math.PI) * 3600);
  const d = Math.floor(s / 3600);
  s -= d * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}

/** Signed degrees with one decimal: "+23.4°". */
export function formatDeg(rad: number, digits = 1): string {
  const d = rad * (180 / Math.PI);
  return `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(digits)}°`;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Azimuth as "244.3° WSW". */
export function formatAzimuth(rad: number): string {
  const d = ((rad * (180 / Math.PI)) % 360 + 360) % 360;
  return `${d.toFixed(1)}° ${POINTS[Math.round(d / 22.5) % 16]}`;
}

export function compassPoint(rad: number): string {
  const d = ((rad * (180 / Math.PI)) % 360 + 360) % 360;
  return POINTS[Math.round(d / 22.5) % 16]!;
}

/** Latitude/longitude as "36.85° S, 174.76° E". */
export function formatLatLon(latDeg: number, lonDeg: number): string {
  return `${Math.abs(latDeg).toFixed(2)}° ${latDeg >= 0 ? 'N' : 'S'}, ${Math.abs(lonDeg).toFixed(2)}° ${lonDeg >= 0 ? 'E' : 'W'}`;
}

/** Visibility class for a visual magnitude. */
export function visibilityClass(mag: number): string {
  if (mag <= 6) return 'Naked eye';
  if (mag <= 9.5) return 'Binoculars';
  return 'Telescope';
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** "1.989 × 10³⁰ kg". */
export function formatSci(x: number, unit: string): string {
  const [m, e] = x.toExponential(3).split('e');
  const exp = Number(e).toString().replace(/-/g, '⁻').replace(/[0-9]/g, (d) => SUPERSCRIPT[Number(d)]!);
  return `${m} × 10${exp} ${unit}`;
}

/** Light-travel time for a distance in metres ("8.3 light-minutes", "2,540,000 light-years"). */
export function lightTime(m: number): string {
  const s = m / 299_792_458;
  if (s < 60) return `${s.toFixed(2)} light-seconds`;
  if (s < 3600) return `${(s / 60).toFixed(1)} light-minutes`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} light-hours`;
  const ly = s / 31_557_600;
  return `${ly.toLocaleString('en-US', { maximumSignificantDigits: ly < 100 ? 3 : 4 })} light-years`;
}
