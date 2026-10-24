/** Shared GLSL noise for procedural volumes and impostors (hash-based, no textures). */

export const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0)), n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1)), n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float fbm(vec3 p, int octaves) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * valueNoise(p);
    p = p * 2.03 + vec3(17.1, 9.2, 3.7);
    a *= 0.5;
  }
  return s;
}

// Interleaved gradient noise: per-pixel jitter for ray-march start points (hides banding).
float ign(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}
`;

/** CPU twin of the GLSL `hash13` (same pattern, for baking textures). */
function hash13(x: number, y: number, z: number): number {
  const fr = (v: number) => v - Math.floor(v);
  let px = fr(x * 0.1031), py = fr(y * 0.1031), pz = fr(z * 0.1031);
  const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += d; py += d; pz += d;
  return fr((px + py) * pz);
}

function valueNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const fx = s(x - ix), fy = s(y - iy), fz = s(z - iz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (dx: number, dy: number, dz: number) => hash13(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy),
    l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz,
  );
}

/** CPU twin of the GLSL `fbm`. */
export function fbm(x: number, y: number, z: number, octaves: number): number {
  let a = 0.5, s = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * valueNoise(x, y, z);
    x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; z = z * 2.03 + 3.7;
    a *= 0.5;
  }
  return s;
}
