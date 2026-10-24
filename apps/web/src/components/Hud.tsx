import { LY, formatDistance, formatSpeed, niceRoundDown } from '@simuverse/astro';
import { useApp } from '../state/store.ts';

const SCALE_BAR_MAX_PX = 140;

/** Bottom-left readout: scale bar, distance (in two unit systems when interstellar) and speed. */
export function Hud() {
  const stats = useApp((s) => s.stats);
  if (!stats) return null;

  const barMetres = niceRoundDown(stats.metresPerPixel * SCALE_BAR_MAX_PX);
  const barPx = barMetres / stats.metresPerPixel;
  const dist = formatDistance(stats.distance);
  const distPc = stats.distance > 0.1 * LY ? formatDistance(stats.distance, 'pc') : null;

  return (
    <div className="glass pointer-events-none absolute bottom-3 left-3 z-10 min-w-52 rounded-xl px-3 py-2 text-xs" aria-live="off">
      <div className="flex items-end gap-2">
        <div className="relative h-2.5 border-x border-b border-[var(--accent-2)]" style={{ width: barPx }} aria-hidden="true" />
        <span className="font-mono tabular-nums">{formatDistance(barMetres).text}</span>
      </div>
      <p className="mt-1.5 font-mono tabular-nums">
        <span className="text-[var(--text-dim)]">to {stats.focusName}</span> {dist.text}
        {distPc && <span className="text-[var(--text-dim)]"> · {distPc.text}</span>}
      </p>
      <p className="font-mono tabular-nums">
        <span className="text-[var(--text-dim)]">speed</span> {formatSpeed(stats.speed).text}
      </p>
    </div>
  );
}

export function PerfOverlay() {
  const stats = useApp((s) => s.stats);
  const show = useApp((s) => s.showPerf);
  const quality = useApp((s) => s.quality);
  if (!show || !stats) return null;
  const tone = stats.fps >= 55 ? 'text-[var(--accent-2)]' : stats.fps >= 30 ? 'text-amber-300' : 'text-rose-400';
  return (
    <div className="glass pointer-events-none absolute bottom-3 right-3 z-10 rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed tabular-nums">
      <p><span className={tone}>{stats.fps.toFixed(0)} fps</span> · {stats.frameMs.toFixed(1)} ms</p>
      <p className="text-[var(--text-dim)]">depth: {stats.depthMode} · {quality}</p>
      <p className="text-[var(--text-dim)]">stars: {stats.starsLoaded ? 'loaded' : 'loading…'}</p>
    </div>
  );
}
