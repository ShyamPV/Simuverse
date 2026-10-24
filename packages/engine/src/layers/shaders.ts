/**
 * Shared GLSL. Point-like light sources (stars, the Sun seen from afar) use one
 * photometric model so brightness is continuous across layers:
 *   E = 10^(-0.4 (m - magRef))   (linear flux relative to magRef)
 * Faint sources keep a minimum size and dim; bright ones grow (∝ E^0.3) and
 * saturate into the HDR range where bloom picks them up.
 */

export const STAR_PSF_VERTEX = /* glsl */ `
uniform float uMagRef;
uniform float uMagLimit;
uniform float uPixelRatio;
uniform float uMaxSize;

// Returns (sizePx, intensity); size 0 means "not visible".
vec2 starPsf(float appMag) {
  if (appMag > uMagLimit) return vec2(0.0);
  float E = exp2(-1.3287712 * (appMag - uMagRef)); // 10^(-0.4 Δm)
  float size = clamp(2.2 * pow(E, 0.3), 2.2, uMaxSize);
  float intensity = min(E / pow(size / 2.2, 2.0), 16.0);
  // Fade the last magnitude before the limit so stars don't pop.
  intensity *= smoothstep(uMagLimit, uMagLimit - 1.0, appMag);
  return vec2(size * uPixelRatio, intensity);
}
`;

export const STAR_PSF_FRAGMENT = /* glsl */ `
float starProfile(vec2 pc) {
  vec2 d = pc * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) return 0.0;
  // Gaussian core plus a faint wide wing, normalised-ish to 1 at the centre.
  return exp(-r2 * 6.0) * 0.85 + exp(-r2 * 1.6) * 0.15 * (1.0 - r2);
}
`;
