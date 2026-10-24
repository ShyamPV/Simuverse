/** Constellation figures, IAU boundaries and label points (d3-celestial, BSD-3-Clause). */

export interface ConstellationData {
  name: string;
  genitive: string;
  /** 1 = major, 3 = faint/minor (for label decluttering). */
  rank: number;
  /** [RA°, Dec°], J2000. */
  label: [number, number];
  /** Stick-figure polylines, [RA°, Dec°] vertices. */
  lines: [number, number][][];
  /** Boundary polygons, [RA°, Dec°] vertices. */
  bounds: [number, number][][];
}

export type Constellations = Record<string, ConstellationData>;

/**
 * Which constellation contains a J2000 position (degrees). Uses the winding
 * number of each boundary polygon around the point on the sphere, so it
 * works for the polar constellations too.
 */
export function constellationAt(data: Constellations, raDeg: number, decDeg: number): string | undefined {
  const d2r = Math.PI / 180;
  const p = unit(raDeg * d2r, decDeg * d2r);
  // Tangent-plane basis at p.
  const east = normalize([-Math.sin(raDeg * d2r), Math.cos(raDeg * d2r), 0]);
  const north = cross(p, east);
  for (const [id, c] of Object.entries(data)) {
    for (const poly of c.bounds) {
      // A polygon around the antipode also winds once around p; every
      // constellation is far smaller than a hemisphere, so require its
      // centroid to lie on p's side of the sky.
      const centroid = poly.reduce<V3>((s, v) => {
        const u = unit(v[0] * d2r, v[1] * d2r);
        return [s[0] + u[0], s[1] + u[1], s[2] + u[2]];
      }, [0, 0, 0]);
      if (centroid[0] * p[0] + centroid[1] * p[1] + centroid[2] * p[2] <= 0) continue;
      let winding = 0;
      let prev = angleAround(poly[poly.length - 1]!, p, east, north, d2r);
      for (const v of poly) {
        const a = angleAround(v, p, east, north, d2r);
        let d = a - prev;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        winding += d;
        prev = a;
      }
      if (Math.abs(winding) > Math.PI) return id;
    }
  }
  return undefined;
}

type V3 = [number, number, number];
const unit = (ra: number, dec: number): V3 => [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Position angle of vertex v as seen from point p (radians), in p's tangent plane. */
function angleAround(v: [number, number], p: V3, east: V3, north: V3, d2r: number): number {
  const q = unit(v[0] * d2r, v[1] * d2r);
  // Project q onto the plane perpendicular to p (direction of the great circle from p to q).
  const k = q[0] * p[0] + q[1] * p[1] + q[2] * p[2];
  const t: V3 = [q[0] - k * p[0], q[1] - k * p[1], q[2] - k * p[2]];
  return Math.atan2(t[0] * east[0] + t[1] * east[1] + t[2] * east[2], t[0] * north[0] + t[1] * north[1] + t[2] * north[2]);
}

export async function loadConstellations(baseUrl: string): Promise<Constellations> {
  const res = await fetch(new URL('constellations.json', baseUrl));
  if (!res.ok) throw new Error(`constellations: HTTP ${res.status}`);
  return res.json() as Promise<Constellations>;
}
