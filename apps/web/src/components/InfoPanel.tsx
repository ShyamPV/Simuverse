import { formatDistance } from '@simuverse/astro';
import { bodyInfo } from '../bodies.ts';
import { useApp } from '../state/store.ts';
import { IconClose, IconPanel } from './icons.tsx';

const KIND_LABEL = { star: 'Star', planet: 'Planet', moon: 'Moon', 'dwarf-planet': 'Dwarf planet' } as const;

function sci(x: number, unit: string): string {
  const [m, e] = x.toExponential(3).split('e');
  return `${m} × 10${Number(e).toString().replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]!)} ${unit}`;
}

export function InfoPanel() {
  const stats = useApp((s) => s.stats);
  const open = useApp((s) => s.infoOpen);
  const set = useApp((s) => s.set);
  const info = stats ? bodyInfo(stats.focusId) : undefined;

  if (!open) {
    return (
      <button
        type="button"
        className="glass btn absolute right-3 top-16 z-20 rounded-xl"
        onClick={() => set({ infoOpen: true })}
        aria-label="Show object info (I)"
        title="Show object info (I)"
      >
        <IconPanel />
      </button>
    );
  }
  if (!stats || !info) return null;

  const rows: [string, string][] = [
    ['Distance from you', formatDistance(stats.distance).text],
    ['Altitude', formatDistance(stats.altitude).text],
    ...(info.id !== 'sun' ? [['From the Sun', formatDistance(stats.focusFromSun).text] as [string, string]] : []),
    ...(info.id !== 'earth' ? [['From Earth', formatDistance(stats.focusFromEarth).text] as [string, string]] : []),
    ['Equatorial radius', `${(info.radius / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 })} km`],
    ['Mass', sci(info.mass, 'kg')],
  ];

  return (
    <aside aria-label="Object information" className="glass absolute right-3 top-16 z-20 w-72 overflow-hidden rounded-xl">
      <div className="relative px-4 pb-3 pt-4">
        <div
          className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full opacity-40 blur-2xl"
          style={{ background: info.color }}
          aria-hidden="true"
        />
        <div className="flex items-start justify-between">
          <div>
            <p className="label-dim">{KIND_LABEL[info.kind]}</p>
            <h2 className="font-display text-2xl font-semibold tracking-tight">{info.name}</h2>
          </div>
          <button type="button" className="btn p-1" onClick={() => set({ infoOpen: false })} aria-label="Hide object info">
            <IconClose size={16} />
          </button>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-[var(--panel-border)] px-4 py-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--text-dim)]">{k}</dt>
            <dd className="text-right font-mono text-[0.8rem] tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-[var(--panel-border)] px-4 py-2 text-[11px] leading-snug text-[var(--text-dim)]">
        Positions: JPL Keplerian approximation (accurate to arcminutes). Full ephemerides arrive in milestone 2.
      </p>
    </aside>
  );
}
