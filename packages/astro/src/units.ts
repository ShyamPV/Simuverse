/** Physical constants and unit conversions. Internal distance unit is the metre. */

export const C_MPS = 299_792_458;
export const KM = 1e3;
export const AU = 149_597_870_700;
export const LY = C_MPS * 86_400 * 365.25;
export const PC = (AU * 648_000) / Math.PI;
export const KPC = PC * 1e3;
export const MPC = PC * 1e6;
export const GPC = PC * 1e9;

export const DEG = Math.PI / 180;
export const ARCSEC = DEG / 3600;
export const DAY_S = 86_400;
export const JULIAN_CENTURY_DAYS = 36_525;

export type DistanceUnit = 'm' | 'km' | 'AU' | 'ly' | 'pc' | 'kpc' | 'Mpc' | 'Gpc';

export const DISTANCE_UNITS: Record<DistanceUnit, number> = {
  m: 1,
  km: KM,
  AU,
  ly: LY,
  pc: PC,
  kpc: KPC,
  Mpc: MPC,
  Gpc: GPC,
};

export interface FormattedQuantity {
  value: number;
  unit: string;
  text: string;
}

function formatNumber(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(2).replace('e+', 'e');
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function quantity(value: number, unit: string): FormattedQuantity {
  return { value, unit, text: `${formatNumber(value)} ${unit}` };
}

/**
 * Picks the most readable unit for a distance in metres: km inside the
 * planetary neighbourhood, AU within the solar system, then light-years
 * (or parsecs with `prefer: 'pc'`) and their kilo/mega/giga multiples.
 */
export function formatDistance(metres: number, prefer: 'ly' | 'pc' = 'ly'): FormattedQuantity {
  const m = Math.abs(metres);
  if (m < KM) return quantity(metres, 'm');
  if (m < 0.1 * AU) return quantity(metres / KM, 'km');
  if (m < 0.1 * LY) return quantity(metres / AU, 'AU');
  if (prefer === 'pc') {
    if (m < KPC) return quantity(metres / PC, 'pc');
    if (m < MPC) return quantity(metres / KPC, 'kpc');
    if (m < GPC) return quantity(metres / MPC, 'Mpc');
    return quantity(metres / GPC, 'Gpc');
  }
  if (m < 1e3 * LY) return quantity(metres / LY, 'ly');
  if (m < 1e6 * LY) return quantity(metres / (1e3 * LY), 'kly');
  if (m < 1e9 * LY) return quantity(metres / (1e6 * LY), 'Mly');
  return quantity(metres / (1e9 * LY), 'Gly');
}

/** Speed in m/s, shown as km/s until 1% of c, then as multiples of c. */
export function formatSpeed(mps: number): FormattedQuantity {
  const a = Math.abs(mps);
  if (a < 1) return quantity(mps, 'm/s');
  if (a < 0.01 * C_MPS) return quantity(mps / KM, 'km/s');
  return quantity(mps / C_MPS, 'c');
}

/** Rounds down to a 1/2/5 × 10ⁿ value, for scale bars. */
export function niceRoundDown(x: number): number {
  if (!(x > 0)) return 0;
  const exp = Math.floor(Math.log10(x));
  const base = 10 ** exp;
  const f = x / base;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * base;
}
