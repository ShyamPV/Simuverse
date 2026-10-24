import type { ViewState } from '@simuverse/engine';

/**
 * Shareable links: the view (camera, target, selection, time) and the
 * observer's location, encoded in the URL hash so any static host serves
 * them. Objects are referenced by catalogue designation or name ("M31",
 * "HIP 32349", "TRAPPIST-1 e"), never by internal indexes.
 *
 *   #v=1&m=o&t=jupiter&c=12.5,3.2,2.3e8&s=io&d=2026-10-24T09:00:00Z&r=100&l=-36.85,174.76&n=Auckland&z=Pacific/Auckland
 */

export interface SharedLocation {
  latDeg: number;
  lonDeg: number;
  name: string;
  tz?: string;
}

export interface SharedView {
  view: ViewState;
  location?: SharedLocation;
  /** An object link (Explore “Copy link”): travel to the target on opening rather than restoring a camera. */
  go?: boolean;
}

const RAD = 180 / Math.PI;
const fixed = (x: number, digits: number) => String(Number(x.toFixed(digits)));
const sig = (x: number, digits: number) => String(Number(x.toPrecision(digits)));

export function encodeShare(view: ViewState, location?: SharedLocation): string {
  const p = new URLSearchParams();
  p.set('v', '1');
  p.set('m', view.mode === 'sky' ? 's' : view.mode === 'fly' ? 'f' : 'o');
  if (view.target) p.set('t', view.target);
  if (view.mode === 'sky') {
    p.set('c', [fixed((view.az ?? 0) * RAD, 3), fixed((view.el ?? 0) * RAD, 3), sig(view.fov ?? 60, 4)].join(','));
  } else if (view.mode === 'fly' && view.pos && view.quat) {
    p.set('c', [...view.pos.map((x) => sig(x, 10)), ...view.quat.map((x) => fixed(x, 5))].join(','));
  } else {
    p.set('c', [fixed((view.az ?? 0) * RAD, 3), fixed((view.el ?? 0) * RAD, 3), sig(view.dist ?? 0, 6)].join(','));
  }
  if (view.selection) p.set('s', view.selection);
  if (view.timeMs !== undefined) {
    p.set('d', new Date(view.timeMs).toISOString().replace('.000Z', 'Z'));
    if (view.rate !== undefined && view.rate !== 1) p.set('r', String(view.rate));
    if (view.paused) p.set('p', '1');
  }
  if (location) {
    p.set('l', `${fixed(location.latDeg, 4)},${fixed(location.lonDeg, 4)}`);
    if (location.name) p.set('n', location.name);
    if (location.tz) p.set('z', location.tz);
  }
  return `#${p.toString()}`;
}

/** Parses a hash from encodeShare(); null if it isn't one (or is malformed). */
export function decodeShare(hash: string): SharedView | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (p.get('v') !== '1') return null;
  const m = p.get('m');
  const mode = m === 's' ? 'sky' : m === 'f' ? 'fly' : m === 'o' ? 'orbit' : null;
  if (!mode) return null;
  const nums = (p.get('c') ?? '').split(',').map(Number);
  const finite = nums.every(Number.isFinite);
  const view: ViewState = { mode };
  const target = p.get('t');
  if (target) view.target = target;
  if (mode === 'sky') {
    if (finite && nums.length === 3) Object.assign(view, { az: nums[0]! / RAD, el: nums[1]! / RAD, fov: nums[2] });
  } else if (mode === 'fly') {
    if (!finite || nums.length !== 7) return null;
    view.pos = [nums[0]!, nums[1]!, nums[2]!];
    view.quat = [nums[3]!, nums[4]!, nums[5]!, nums[6]!];
  } else if (finite && nums.length === 3) {
    Object.assign(view, { az: nums[0]! / RAD, el: nums[1]! / RAD, dist: nums[2] });
  }
  const sel = p.get('s');
  if (sel) view.selection = sel;
  const d = p.get('d');
  if (d) {
    const ms = Date.parse(d);
    if (Number.isFinite(ms)) {
      view.timeMs = ms;
      const r = Number(p.get('r') ?? '1');
      view.rate = Number.isFinite(r) ? r : 1;
      view.paused = p.get('p') === '1';
    }
  }
  const out: SharedView = { view };
  if (p.get('go') === '1' && target) out.go = true;
  const l = (p.get('l') ?? '').split(',').map(Number);
  if (l.length === 2 && l.every(Number.isFinite) && Math.abs(l[0]!) <= 90 && Math.abs(l[1]!) <= 180) {
    out.location = { latDeg: l[0]!, lonDeg: l[1]!, name: p.get('n') ?? `${l[0]!.toFixed(2)}, ${l[1]!.toFixed(2)}` };
    const tz = p.get('z');
    if (tz) out.location.tz = tz;
  }
  return out;
}
