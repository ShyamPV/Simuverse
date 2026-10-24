/**
 * Scale-dependent behaviour of the Universe view: auto-exposure and the
 * "scale ladder" that re-centres the orbit camera as you zoom out (and back in).
 */

import { AU, KPC, MPC, PC } from '@simuverse/astro';

/** Ladder of orbit centres, innermost first. Planets sit below 'sun'. */
export const LADDER = ['sun', 'galaxy', 'local-group', 'universe'] as const;
export type LadderId = (typeof LADDER)[number];

/**
 * Zooming out past `up` hands the orbit centre to the next rung; zooming in
 * below `down` hands it back. The gap between them is hysteresis.
 */
const RUNGS: Record<LadderId, { up?: number; down?: number }> = {
  sun: { up: 30 * KPC },
  galaxy: { up: 2.5 * MPC, down: 12 * KPC },
  'local-group': { up: 150 * MPC, down: 0.9 * MPC },
  universe: { down: 60 * MPC },
};

/** Planets hand over to the Sun beyond this distance when zooming out. */
const PLANET_TO_SUN = 2000 * AU;

/**
 * The next orbit centre for the current focus and camera distance from it,
 * or null to stay. Only ladder centres (and solar-system bodies → Sun) take
 * part; anything else the user chose (a galaxy, a nebula, Virgo, Laniakea)
 * is never re-centred automatically.
 */
export function ladderStep(focusId: string, distance: number, zoomingOut: boolean, isSolarBody: boolean): LadderId | null {
  if (!(LADDER as readonly string[]).includes(focusId)) {
    return isSolarBody && zoomingOut && distance > PLANET_TO_SUN ? 'sun' : null;
  }
  const id = focusId as LadderId;
  const i = LADDER.indexOf(id);
  const r = RUNGS[id];
  if (zoomingOut && r.up !== undefined && distance > r.up) return LADDER[i + 1]!;
  if (!zoomingOut && r.down !== undefined && distance < r.down) return LADDER[i - 1]!;
  return null;
}

/**
 * Auto-exposure from the camera's distance to the Sun. Within a few kpc
 * nothing changes; beyond, point sources get a magnitude boost so distant
 * galaxies remain visible (like a long exposure), capped at 16 mag. Resolved
 * (extended) objects get a gentler gain so they don't wash out.
 */
export function exposureFor(distanceFromSunM: number): { pointMag: number; extendedGain: number } {
  const pc = distanceFromSunM / PC;
  const pointMag = Math.min(Math.max(3.5 * Math.log10(pc / 3000), 0), 14);
  return { pointMag, extendedGain: 10 ** (0.4 * Math.min(pointMag, 4)) };
}

/** Schechter characteristic absolute magnitude (V) of galaxies. */
const M_STAR = -21;

/**
 * Magnitude reference for galaxy points in Universe view: an L* galaxy at the
 * current viewing distance renders at unit brightness, so every scale shows
 * its own structure at a readable level (instead of a long exposure that
 * saturates hundreds of thousands of background galaxies). Never fainter than
 * the naked-eye reference used near home.
 */
export function galaxyMagRef(viewDistanceM: number, nakedEyeRef: number): number {
  const pc = Math.max(viewDistanceM / PC, 10);
  return Math.min(Math.max(M_STAR + 5 * Math.log10(pc / 10) + 1.5, nakedEyeRef), 26);
}

/**
 * Scale-dependent depth fog for galaxies (Mpc): objects beyond ~12× the
 * current viewing distance fade out, so a Local Group view isn't drowned by
 * the deep-field background while the universe view still shows everything.
 */
export function sceneFogMpc(viewDistanceM: number): number {
  return Math.max((12 * viewDistanceM) / MPC, 5);
}
