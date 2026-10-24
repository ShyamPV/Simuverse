import { SOLAR_SYSTEM } from '@simuverse/astro';

/** Number-key shortcuts for solar-system bodies (also their display order). */
export const BODY_SHORTCUTS: ReadonlyArray<{ id: string; key: string }> = [
  { id: 'sun', key: '0' },
  { id: 'mercury', key: '1' },
  { id: 'venus', key: '2' },
  { id: 'earth', key: '3' },
  { id: 'mars', key: '4' },
  { id: 'jupiter', key: '5' },
  { id: 'saturn', key: '6' },
  { id: 'uranus', key: '7' },
  { id: 'neptune', key: '8' },
  { id: 'moon', key: '9' },
];

export const bodyInfo = (id: string) => SOLAR_SYSTEM.find((b) => b.id === id);

/** Time-rate steps, in simulated seconds per real second. */
export const RATE_STEPS = [-1e6, -1e5, -1e4, -1e3, -100, -10, -1, 1, 10, 100, 1e3, 1e4, 1e5, 1e6] as const;

export function stepRate(current: number, dir: 1 | -1): number {
  let idx = RATE_STEPS.findIndex((r) => r >= current);
  if (idx < 0) idx = RATE_STEPS.length - 1;
  if (RATE_STEPS[idx] !== current) idx = dir > 0 ? idx : idx - 1;
  else idx += dir;
  return RATE_STEPS[Math.min(Math.max(idx, 0), RATE_STEPS.length - 1)]!;
}

export function formatRate(rate: number): string {
  const sign = rate < 0 ? '−' : '';
  const a = Math.abs(rate);
  return `${sign}×${a >= 1e6 ? `${a / 1e6}M` : a >= 1e3 ? `${a / 1e3}k` : a}`;
}
