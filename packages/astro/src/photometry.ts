/** Magnitudes and stellar colours. */

/** Apparent magnitude from absolute magnitude and distance in parsecs. */
export const apparentMagnitude = (absMag: number, distPc: number): number =>
  absMag + 5 * Math.log10(Math.max(distPc, 1e-12) / 10);

/** Flux ratio relative to a reference magnitude. */
export const fluxRatio = (mag: number, refMag = 0): number => 10 ** (-0.4 * (mag - refMag));

/** Effective temperature (K) from B−V colour index (Ballesteros 2012). */
export function bvToTemperature(bv: number): number {
  const c = Math.max(-0.4, Math.min(2.0, bv));
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
}

// CIE 1931 2° colour matching functions, multi-lobe Gaussian fit
// (Wyman, Sloan & Shirley 2013, "Simple Analytic Approximations to the CIE XYZ
// Color Matching Functions"). λ in nm.
function g(x: number, mu: number, s1: number, s2: number): number {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}
const cieX = (l: number) => 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2);
const cieY = (l: number) => 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1);
const cieZ = (l: number) => 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8);

function planck(lambdaNm: number, T: number): number {
  const l = lambdaNm * 1e-9;
  return 1 / (l ** 5 * (Math.exp(1.4387769e-2 / (l * T)) - 1));
}

/**
 * Linear sRGB chromaticity of a blackbody at temperature T, normalised so the
 * largest channel is 1. Intensity is carried separately by magnitude.
 */
export function blackbodyRgb(T: number): [number, number, number] {
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const p = planck(l, T);
    X += p * cieX(l);
    Y += p * cieY(l);
    Z += p * cieZ(l);
  }
  // XYZ → linear sRGB (D65)
  let r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  let gr = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  let b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  r = Math.max(r, 0);
  gr = Math.max(gr, 0);
  b = Math.max(b, 0);
  const m = Math.max(r, gr, b) || 1;
  return [r / m, gr / m, b / m];
}

export const bvToRgb = (bv: number): [number, number, number] => blackbodyRgb(bvToTemperature(bv));
