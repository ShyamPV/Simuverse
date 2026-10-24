import { AU } from '@simuverse/astro';
import type { ZoomLevel } from '@simuverse/engine';
import { useApp } from '../state/store.ts';
import { IconCamera, IconChevronRight, IconHelp } from './icons.tsx';

interface Crumb {
  label: string;
  level?: ZoomLevel;
  /** Milestone in which this level becomes reachable. */
  pending?: number;
}

/** Breadcrumb levels from the camera outward; the last reachable one is "current". */
function useCrumbs(): { crumbs: Crumb[]; current: number } {
  const stats = useApp((s) => s.stats);
  const crumbs: Crumb[] = [
    { label: stats?.focusId === 'sun' ? 'Earth' : (stats?.focusName ?? 'Earth'), level: 'planet' },
    { label: 'Solar System', level: 'solar-system' },
    { label: 'Milky Way', level: 'stellar-neighbourhood' },
    { label: 'Local Group', pending: 3 },
    { label: 'Virgo Supercluster', pending: 3 },
    { label: 'Laniakea', pending: 3 },
  ];
  let current = 0;
  if (stats) {
    if (stats.distanceFromSun > 2000 * AU) current = 2;
    else if (stats.focusId === 'sun' || stats.distance > 0.02 * AU) current = 1;
  }
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
        <ol className="flex min-w-0 items-center">
          {crumbs.map((c, i) => (
            <li key={c.label + i} className="flex items-center">
              {i > 0 && <IconChevronRight size={14} className="mx-0.5 shrink-0 text-[var(--text-dim)]" />}
              <button
                type="button"
                className={`btn whitespace-nowrap px-2 py-1 text-xs ${i === current ? 'is-active' : ''}`}
                aria-current={i === current ? 'location' : undefined}
                disabled={!c.level || !engine}
                title={c.pending ? `Arrives in milestone ${c.pending}` : `Zoom to ${c.label}`}
                onClick={() => c.level && engine?.zoomToLevel(c.level)}
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
