/**
 * Naked-eye limiting magnitude against the twilight sky, piecewise-linear in
 * the Sun's altitude: daylight (Venus at best), civil, nautical and
 * astronomical twilight, then the site's dark-sky limit. Moonlight and light
 * pollution beyond `darkLimit` are not modelled.
 */
const STEPS: readonly [number, number][] = [
  [-1, -4],
  [-6, 1.5],
  [-12, 4.5],
];

export function limitingMagnitude(sunAltDeg: number, darkLimit = 6.5): number {
  const pts: [number, number][] = [...STEPS, [-18, darkLimit]];
  if (sunAltDeg >= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [a0, m0] = pts[i - 1]!, [a1, m1] = pts[i]!;
    if (sunAltDeg >= a1) return m0 + ((sunAltDeg - a0) / (a1 - a0)) * (m1 - m0);
  }
  return darkLimit;
}
