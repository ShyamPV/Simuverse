import { LY, formatDistance, formatSpeed, niceRoundDown } from '@simuverse/astro';
import { compassPoint, formatDeg } from '../format.ts';
import { useApp } from '../state/store.ts';

const SCALE_BAR_MAX_PX = 140;

/**
 * Bottom-left readout. Universe mode: scale bar, distance (two unit systems
 * when interstellar) and speed. Sky mode: view direction, field of view and Sun altitude.
 */
export function Hud() {
  const stats = useApp((s) => s.stats);
  if (!stats) return null;

  if (stats.mode === 'sky' && stats.view) {
    const sun = stats.sunAltDeg;
    const phase =
      sun === null ? '' : sun > -0.833 ? 'Daytime' : sun > -6 ? 'Civil twilight' : sun > -12 ? 'Nautical twilight' : sun > -18 ? 'Astronomical twilight' : 'Night';
    return (
      <div className="glass pointer-events-none absolute bottom-3 left-3 z-10 min-w-52 rounded-xl px-3 py-2 text-xs">
        <p className="font-mono tabular-nums">
          <span className="text-[var(--text-dim)]">looking</span> {compassPoint(stats.view.az)} · {formatDeg(stats.view.alt, 0)}
        </p>
        <p className="font-mono tabular-nums">
          <span className="text-[var(--text-dim)]">field</span>{' '}
          {stats.fovDeg >= 1 ? `${stats.fovDeg.toFixed(stats.fovDeg < 10 ? 1 : 0)}°` : `${(stats.fovDeg * 60).toFixed(1)}′`}
        </p>
        {sun !== null && (
          <p className="font-mono tabular-nums">
            <span className="text-[var(--text-dim)]">{phase}</span> · Sun {sun.toFixed(1)}°
          </p>
        )}
      </div>
    );
  }

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
        {stats.nav === 'fly' && <span className="text-[var(--text-dim)]"> · ×{formatFactor(stats.flyFactor)}</span>}
      </p>
      {stats.warp && (
        <div className="mt-1.5" aria-live="polite">
          <p className="font-mono tabular-nums">
            <span className="text-[var(--accent-2)]">warping</span> to {stats.warp.name} · {stats.warp.remaining.toFixed(1)} s
          </p>
          <div className="mt-1 h-1 overflow-hidden rounded bg-white/10" aria-hidden="true">
            <div className="h-full bg-[var(--accent-2)]" style={{ width: `${(stats.warp.progress * 100).toFixed(1)}%` }} />
          </div>
        </div>
      )}
      {stats.nav === 'fly' && (
        <p className="mt-1.5 text-[var(--text-dim)]">
          <span className="text-[var(--accent-2)]">free flight</span> · <kbd className="kbd">W</kbd><kbd className="kbd">A</kbd><kbd className="kbd">S</kbd><kbd className="kbd">D</kbd> move ·{' '}
          <kbd className="kbd">Q</kbd><kbd className="kbd">E</kbd> down/up · <kbd className="kbd">⇧</kbd> boost · scroll: speed · <kbd className="kbd">F</kbd> orbit
        </p>
      )}
    </div>
  );
}

function formatFactor(f: number): string {
  return f >= 1 ? f.toFixed(f < 10 ? 2 : 0) : `1/${(1 / f).toFixed(1 / f < 10 ? 2 : 0)}`;
}

export function PerfOverlay() {
  const stats = useApp((s) => s.stats);
  const show = useApp((s) => s.showPerf);
  const quality = useApp((s) => s.quality);
  if (!show || !stats) return null;
  const tone = stats.fps >= 55 ? 'text-[var(--accent-2)]' : stats.fps >= 30 ? 'text-amber-300' : 'text-rose-400';
  const sats = stats.satellites;
  return (
    <div className="glass pointer-events-none absolute bottom-3 right-3 z-10 rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed tabular-nums">
      <p><span className={tone}>{stats.fps.toFixed(0)} fps</span> · {stats.frameMs.toFixed(1)} ms</p>
      <p className="text-[var(--text-dim)]">
        cpu {stats.cpuMs.toFixed(1)} ms · gpu {stats.gpuMs === null ? 'n/a' : `${stats.gpuMs.toFixed(1)} ms`} · {stats.drawCalls} draws
      </p>
      <p className="text-[var(--text-dim)]">
        depth: {stats.depthMode} · {quality}{stats.renderScale < 1 && ` · resolution ${Math.round(stats.renderScale * 100)}%`}
      </p>
      <p className="text-[var(--text-dim)]">stars: {stats.starsLoaded ? 'loaded' : 'loading…'}</p>
      <p className="text-[var(--text-dim)]">ephemeris: {stats.precise ? 'DE440' : 'approximate'}</p>
      <p className="text-[var(--text-dim)]">satellites: {sats ? `${sats.count} (${sats.source})` : 'loading…'}</p>
      <p className="text-[var(--text-dim)]">gaia/tycho stars: {stats.deep.octreeStars.toLocaleString('en-US')}</p>
      <p className="text-[var(--text-dim)]">
        galaxies: {stats.deep.catalogGalaxies.toLocaleString('en-US')} + {stats.deep.proceduralGalaxies.toLocaleString('en-US')} procedural
      </p>
      {stats.exposureMag > 0.05 && <p className="text-[var(--text-dim)]">auto-exposure: +{stats.exposureMag.toFixed(1)} mag</p>}
    </div>
  );
}
