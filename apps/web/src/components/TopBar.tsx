import { AU, KPC, MPC } from '@simuverse/astro';
import type { ZoomLevel } from '@simuverse/engine';
import { useApp } from '../state/store.ts';
import { IconCamera, IconChevronRight, IconHelp } from './icons.tsx';

interface Crumb {
  label: string;
  level: ZoomLevel;
}

/** Where the camera is on the cosmic address, from its distance to the Sun. */
export function currentCrumb(mode: 'sky' | 'universe', distanceFromSun: number, focusId: string, distance: number): number {
  if (mode === 'sky') return 0;
  if (distanceFromSun > 1000 * MPC) return 7;
  if (distanceFromSun > 120 * MPC) return 6;
  if (distanceFromSun > 6 * MPC) return 5;
  if (distanceFromSun > 150 * KPC) return 4;
  if (distanceFromSun > 2000 * AU) return 3;
  if (focusId === 'sun' || distance > 0.02 * AU) return 2;
  return 1;
}

function useCrumbs(): { crumbs: Crumb[]; current: number } {
  const stats = useApp((s) => s.stats);
  const location = useApp((s) => s.location);
  const place = location?.name.split(',')[0] ?? 'Your sky';
  const planet = stats?.mode === 'universe' && stats.focusId !== 'sun' && !stats.focusId.includes(':') &&
    !['galaxy', 'local-group', 'virgo', 'laniakea', 'universe'].includes(stats.focusId) ? stats.focusName : 'Earth';
  const crumbs: Crumb[] = [
    { label: `Sky · ${place}`, level: 'sky' },
    { label: planet, level: 'planet' },
    { label: 'Solar System', level: 'solar-system' },
    { label: 'Milky Way', level: 'milky-way' },
    { label: 'Local Group', level: 'local-group' },
    { label: 'Virgo Supercluster', level: 'virgo' },
    { label: 'Laniakea', level: 'laniakea' },
    { label: 'Observable Universe', level: 'universe' },
  ];
  const current = stats ? currentCrumb(stats.mode, stats.distanceFromSun, stats.focusId, stats.distance) : 0;
  return { crumbs, current };
}

export function TopBar() {
  const engine = useApp((s) => s.engine);
  const set = useApp((s) => s.set);
  const { crumbs, current } = useCrumbs();

  const screenshot = () => {
    if (!engine) return;
    const a = document.createElement('a');
    a.href = engine.screenshot();
    a.download = `simuverse-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
  };

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-3">
      <nav aria-label="Cosmic address" className="glass pointer-events-auto flex min-w-0 items-center rounded-xl px-2 py-1">
        <ol className="flex min-w-0 items-center overflow-hidden">
          {crumbs.map((c, i) => (
            <li key={c.level} className="flex min-w-0 items-center">
              {i > 0 && <IconChevronRight size={14} className="mx-0.5 shrink-0 text-[var(--text-dim)]" />}
              <button
                type="button"
                className={`btn whitespace-nowrap px-2 py-1 text-xs ${i === current ? 'is-active' : ''}`}
                aria-current={i === current ? 'location' : undefined}
                disabled={!engine}
                title={`Go to ${c.label}`}
                onClick={() => engine?.zoomToLevel(c.level)}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="glass pointer-events-auto flex items-center gap-1 rounded-xl p-1">
        <button type="button" className="btn" onClick={screenshot} title="Save screenshot (C)" aria-label="Save screenshot">
          <IconCamera />
        </button>
        <button type="button" className="btn" onClick={() => set({ helpOpen: true })} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          <IconHelp />
        </button>
      </div>
    </header>
  );
}
