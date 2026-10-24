/** Minimal double-precision vector/matrix helpers (plain arrays, no GPU types). */

export type Vec3 = [number, number, number];
/** Row-major 3×3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];

export function add(a: Vec3, b: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

export function sub(a: Vec3, b: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

export function scale(a: Vec3, s: number, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export function normalize(a: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const l = length(a) || 1;
  return scale(a, 1 / l, out);
}

/** Angle between two vectors in radians (numerically stable for small angles). */
export function angleBetween(a: Vec3, b: Vec3): number {
  const c: Vec3 = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  return Math.atan2(length(c), dot(a, b));
}

export function mulMat3Vec(m: Mat3, v: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const x = v[0], y = v[1], z = v[2];
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
    }
  }
  return out;
}

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** Rotation of the coordinate frame about X by angle (passive rotation, as in astronomy texts). */
export function rotX(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

export function rotZ(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

export function sphericalToCartesian(lon: number, lat: number, r = 1): Vec3 {
  const cl = Math.cos(lat);
  return [r * cl * Math.cos(lon), r * cl * Math.sin(lon), r * Math.sin(lat)];
}

/** Returns [lon ∈ [0, 2π), lat, r]. */
export function cartesianToSpherical(v: Vec3): Vec3 {
  const r = length(v);
  let lon = Math.atan2(v[1], v[0]);
  if (lon < 0) lon += 2 * Math.PI;
  return [lon, r === 0 ? 0 : Math.asin(v[2] / r), r];
}

export const wrap2Pi = (a: number): number => {
  const t = a % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
};

export const wrap360 = (a: number): number => {
  const t = a % 360;
  return t < 0 ? t + 360 : t;
};
