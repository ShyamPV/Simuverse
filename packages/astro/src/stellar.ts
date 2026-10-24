/**
 * Stellar physical estimates from catalogue photometry, for drawing stars as
 * discs and placing habitable zones when a star's own measurements are missing.
 */

export const SUN_TEFF = 5772;
const SUN_MBOL = 4.74;

/** Effective temperature (K) from B−V (Ballesteros 2012, blackbody fit; good for 3,000–30,000 K). */
export function teffFromBv(bv: number): number {
  const x = Math.min(Math.max(bv, -0.4), 2.2);
  return 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62));
}

/** V-band bolometric correction from Teff (Flower 1996, coefficients as corrected by Torres 2010). */
export function bolometricCorrection(teff: number): number {
  const l = Math.log10(Math.min(Math.max(teff, 2500), 50000));
  const c =
    l < 3.7
      ? [-0.190537291496456e5, 0.155144866764412e5, -0.421278819301717e4, 0.381476328422343e3]
      : l < 3.9
        ? [-0.370510203809015e5, 0.385672629965804e5, -0.150651486316025e5, 0.261724637119416e4, -0.170623810323864e3]
        : [-0.118115450538963e6, 0.137145973583929e6, -0.636233812100225e5, 0.147412923562646e5, -0.170587278406872e4, 0.78873172180499e2];
  return c.reduce((s, k, i) => s + k * l ** i, 0);
}

/** Luminosity in solar units from absolute V magnitude and Teff. */
export function luminosityFromAbsMag(absV: number, teff: number): number {
  return 10 ** (-0.4 * (absV + bolometricCorrection(teff) - SUN_MBOL));
}

/** Radius in solar radii from luminosity (L☉) and Teff (Stefan–Boltzmann). */
export function radiusFromLuminosity(lum: number, teff: number): number {
  return Math.sqrt(lum) * (SUN_TEFF / teff) ** 2;
}

/** Teff, luminosity and radius from catalogue B−V and absolute magnitude. */
export function starPhysics(absV: number, bv: number): { teff: number; lum: number; radiusSun: number } {
  const teff = teffFromBv(bv);
  const lum = luminosityFromAbsMag(absV, teff);
  return { teff, lum, radiusSun: radiusFromLuminosity(lum, teff) };
}

/**
 * Conservative habitable zone (runaway greenhouse → maximum greenhouse), AU,
 * after Kopparapu et al. (2014) for an Earth-mass planet; Teff clamped to the
 * fit's 2,600–7,200 K range.
 */
export function habitableZone(lum: number, teff: number): { inner: number; outer: number } {
  const t = Math.min(Math.max(teff, 2600), 7200) - SUN_TEFF;
  const seff = (s: number, a: number, b: number, c: number, d: number) => s + a * t + b * t ** 2 + c * t ** 3 + d * t ** 4;
  const inner = seff(1.107, 1.332e-4, 1.58e-8, -8.308e-12, -1.931e-15);
  const outer = seff(0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16);
  return { inner: Math.sqrt(lum / inner), outer: Math.sqrt(lum / outer) };
}

/** Rough spectral class letter from Teff, for display when the catalogue has none. */
export function spectralClassFromTeff(teff: number): string {
  if (teff >= 30000) return 'O';
  if (teff >= 10000) return 'B';
  if (teff >= 7500) return 'A';
  if (teff >= 6000) return 'F';
  if (teff >= 5200) return 'G';
  if (teff >= 3700) return 'K';
  return 'M';
}

const COLOUR_BY_CLASS: Record<string, string> = { O: 'Blue', B: 'Blue-white', A: 'White', F: 'Yellow-white', G: 'Yellow', K: 'Orange', M: 'Red' };

/**
 * Plain-language type from a spectral classification ("M1-M2Ia-Iab" → "Red
 * supergiant", "G2V" → "Yellow main-sequence star"), falling back to Teff.
 */
export function describeSpectralType(spect: string | undefined, teff: number): string {
  const s = (spect ?? '').trim();
  if (/^D[ABOQZCX]?/.test(s)) return 'White dwarf';
  const letter = /^[OBAFGKM]/.exec(s)?.[0] ?? spectralClassFromTeff(teff);
  const colour = COLOUR_BY_CLASS[letter] ?? 'Yellow';
  // Luminosity class: the roman numeral after the temperature class (which may be a range, "M1-M2").
  const rest = s.replace(/^[OBAFGKM][\d.]*(?:[-/][OBAFGKM]?[\d.]+)*/, '');
  const lc = /^\s*(Ia\+|Iab|Ia|Ib|III|II|IV|VI|V|I)(?![IV])/.exec(rest)?.[1];
  switch (lc) {
    case 'Ia+': case 'Ia': case 'Iab': case 'Ib': case 'I': return `${colour} supergiant`;
    case 'II': return `${colour} bright giant`;
    case 'III': return `${colour} giant`;
    case 'IV': return `${colour} subgiant`;
    case 'V': return letter === 'M' || letter === 'K' ? `${colour} dwarf` : `${colour} main-sequence star`;
    case 'VI': return `${colour} subdwarf`;
    default: return `${colour} star`;
  }
}
