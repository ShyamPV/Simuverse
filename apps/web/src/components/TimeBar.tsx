import { MAX_SIM_MS, MIN_SIM_MS } from '@simuverse/engine';
import { formatRate, stepRate } from '../bodies.ts';
import { useApp, useDisplayTimeZone } from '../state/store.ts';
import { fromZonedInput, toZonedInput, zoneAbbreviation } from '../zonedTime.ts';
import { IconFaster, IconNow, IconPause, IconPlay, IconSlower } from './icons.tsx';

export function TimeBar() {
  const engine = useApp((s) => s.engine);
  const stats = useApp((s) => s.stats);
  const tz = useDisplayTimeZone();
  if (!engine || !stats) return null;

  const t = engine.time;
  const live = !stats.paused && stats.rate === 1 && Math.abs(stats.simTimeMs - Date.now()) < 5000;
  const date = new Date(stats.simTimeMs);
  const dateFmt = new Intl.DateTimeFormat(undefined, { timeZone: tz, year: 'numeric', month: 'short', day: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3">
      <div className="glass pointer-events-auto flex items-center gap-1 rounded-2xl px-2 py-1.5" role="group" aria-label="Time controls">
        <button type="button" className="btn" onClick={() => t.setRate(stepRate(t.rate, -1))} title="Slower / reverse ([)" aria-label="Slower or reverse">
          <IconSlower size={16} />
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => t.setPaused(!t.paused)}
          title={stats.paused ? 'Play (Space)' : 'Pause (Space)'}
          aria-label={stats.paused ? 'Play' : 'Pause'}
        >
          {stats.paused ? <IconPlay size={16} /> : <IconPause size={16} />}
        </button>
        <button type="button" className="btn" onClick={() => t.setRate(stepRate(t.rate, 1))} title="Faster (])" aria-label="Faster">
          <IconFaster size={16} />
        </button>
        <span
          className={`w-16 text-center font-mono text-xs tabular-nums ${stats.rate < 0 ? 'text-amber-300' : 'text-[var(--accent-2)]'}`}
          aria-label={`Rate ${formatRate(stats.rate)}`}
        >
          {stats.paused ? 'paused' : formatRate(stats.rate)}
        </span>

        <label className="relative mx-2 flex flex-col items-center px-2 leading-tight" title={`Pick a date and time (${tz})`}>
          <span className="font-display text-sm font-medium tabular-nums">{dateFmt.format(date)}</span>
          <span className="font-mono text-[11px] tabular-nums text-[var(--text-dim)]">
            {timeFmt.format(date)} {zoneAbbreviation(stats.simTimeMs, tz)}
          </span>
          <input
            type="datetime-local"
            aria-label="Simulation date and time"
            className="absolute inset-0 cursor-pointer opacity-0"
            min={toZonedInput(MIN_SIM_MS, tz)}
            max={toZonedInput(MAX_SIM_MS, tz)}
            value={toZonedInput(stats.simTimeMs, tz)}
            onChange={(e) => {
              const ms = fromZonedInput(e.target.value, tz);
              if (ms !== null) t.setTimeMs(ms);
            }}
          />
        </label>

        <button type="button" className={`btn ${live ? 'is-active' : ''}`} onClick={() => t.resetToNow()} title="Jump to now (N)">
          <IconNow size={16} />
          <span className="text-xs">{live ? 'Live' : 'Now'}</span>
        </button>
      </div>
    </footer>
  );
}
