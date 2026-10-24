import type { QualityPreset, ZoomLevel } from '@simuverse/engine';
import { useEffect, useState } from 'react';
import { BODY_SHORTCUTS, bodyInfo } from '../bodies.ts';
import { type NavSection, type Theme, useApp } from '../state/store.ts';
import { IconClose, IconExplore, IconMenu, IconSettings, IconSky, IconUniverse } from './icons.tsx';
import { SkyPanel } from './SkyPanel.tsx';
import { Toggle } from './Toggle.tsx';

const SECTIONS: { id: NavSection; label: string; Icon: typeof IconUniverse; pending?: number }[] = [
  { id: 'universe', label: 'Universe', Icon: IconUniverse },
  { id: 'sky', label: 'Sky', Icon: IconSky },
  { id: 'explore', label: 'Explore', Icon: IconExplore },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
];

export function LeftNav() {
  const navOpen = useApp((s) => s.navOpen);
  const section = useApp((s) => s.section);
  const set = useApp((s) => s.set);

  return (
    <aside className="pointer-events-none absolute bottom-40 left-0 top-14 z-30 flex gap-2 p-3">
      <nav aria-label="Main" className="glass pointer-events-auto flex w-14 flex-col items-center gap-1 rounded-xl py-2">
        <button
          type="button"
          className="btn mb-1 h-10 w-10 p-0"
          aria-expanded={navOpen}
          aria-controls="nav-panel"
          title={navOpen ? 'Collapse panel' : 'Expand panel'}
          onClick={() => set({ navOpen: !navOpen })}
        >
          <IconMenu />
        </button>
        {SECTIONS.map(({ id, label, Icon, pending }) => (
          <button
            key={id}
            type="button"
            className="btn h-11 w-11 flex-col gap-0 p-0 text-[10px]"
            aria-pressed={section === id}
            disabled={!!pending}
            title={pending ? `${label}: arrives in milestone ${pending}` : label}
            onClick={() => {
              set({ section: id, navOpen: true });
              // The Sky and Universe sections double as view-mode switches.
              const engine = useApp.getState().engine;
              if (id === 'sky') engine?.enterSky();
              if (id === 'universe' && engine?.viewMode === 'sky') engine.zoomToLevel('planet');
            }}
          >
            <Icon size={18} />
            <span className="mt-0.5 leading-none">{label}</span>
          </button>
        ))}
      </nav>
      {navOpen && section !== 'explore' && (
        <section id="nav-panel" aria-label={section} className="glass pointer-events-auto flex w-64 flex-col overflow-hidden rounded-xl">
          <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-4 py-3">
            <h2 className="font-display text-sm font-semibold tracking-wide">
              {SECTIONS.find((s) => s.id === section)?.label}
            </h2>
            <button type="button" className="btn p-1" aria-label="Close panel" onClick={() => set({ navOpen: false })}>
              <IconClose size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {section === 'universe' && <UniversePanel />}
            {section === 'sky' && <SkyPanel />}
            {section === 'settings' && <SettingsPanel />}
          </div>
        </section>
      )}
    </aside>
  );
}

function UniversePanel() {
  const engine = useApp((s) => s.engine);
  const focusId = useApp((s) => s.stats?.focusId);
  const showLabels = useApp((s) => s.showLabels);
  const showOrbits = useApp((s) => s.showOrbits);
  const deep = useApp((s) => s.deep);
  const setDeep = useApp((s) => s.setDeep);
  const set = useApp((s) => s.set);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="label-dim mb-2">Solar System</p>
        <ul className="flex flex-col gap-0.5">
          {BODY_SHORTCUTS.map(({ id, key }) => {
            const info = bodyInfo(id)!;
            return (
              <li key={id}>
                <button
                  type="button"
                  className="btn w-full justify-start"
                  aria-pressed={focusId === id}
                  onClick={() => engine?.focus(id)}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: info.color, boxShadow: `0 0 8px ${info.color}` }} />
                  <span className={info.kind === 'moon' ? 'pl-3 text-[var(--text-dim)]' : ''}>{info.name}</span>
                  <span className="kbd ml-auto">{key}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <p className="label-dim mb-2">Beyond the Solar System</p>
        <ul className="flex flex-col gap-0.5">
          {BEYOND.map(([level, label, hint]) => (
            <li key={level}>
              <button type="button" className="btn w-full justify-between" onClick={() => engine?.zoomToLevel(level)}>
                <span>{label}</span>
                <span className="text-[11px] text-[var(--text-dim)]">{hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1">
        <p className="label-dim mb-1">Overlays</p>
        <Toggle label="Labels" shortcut="L" checked={showLabels} onChange={(v) => set({ showLabels: v })} />
        <Toggle label="Orbits" shortcut="O" checked={showOrbits} onChange={(v) => set({ showOrbits: v })} />
        <Toggle label="Galaxies" checked={deep.galaxies} onChange={(v) => setDeep({ galaxies: v })} />
        <Toggle label="Nebulae & clusters" checked={deep.deepSky} onChange={(v) => setDeep({ deepSky: v })} />
        <Toggle label="Milky Way" checked={deep.milkyWay} onChange={(v) => setDeep({ milkyWay: v })} />
      </div>
    </div>
  );
}

const BEYOND: [ZoomLevel, string, string][] = [
  ['milky-way', 'Milky Way', '30 kpc'],
  ['local-group', 'Local Group', '3 Mpc'],
  ['virgo', 'Virgo Supercluster', '33 Mpc'],
  ['laniakea', 'Laniakea', '160 Mpc'],
  ['universe', 'Observable Universe', '28.5 Gpc'],
];

interface Credit {
  title: string;
  author: string;
  source: string;
  license: string;
  licenseUrl: string;
}

function SettingsPanel() {
  const s = useApp();
  const [credits, setCredits] = useState<Credit[]>([]);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/attributions.json`)
      .then((r) => r.json() as Promise<Credit[]>)
      .then(setCredits)
      .catch(() => setCredits([]));
  }, []);

  return (
    <div className="flex flex-col gap-5 text-sm">
      <fieldset>
        <legend className="label-dim mb-2">Quality</legend>
        <div className="grid grid-cols-4 gap-1">
          {(['low', 'medium', 'high', 'ultra'] as QualityPreset[]).map((q) => (
            <button key={q} type="button" className="btn px-1 capitalize" aria-pressed={s.quality === q} onClick={() => s.set({ quality: q })}>
              {q}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label-dim mb-2">Theme</legend>
        <div className="flex flex-col gap-1">
          {([['default', 'Deep space'], ['night', 'Night vision (red)'], ['contrast', 'High contrast']] as [Theme, string][]).map(([t, label]) => (
            <button key={t} type="button" className="btn justify-start" aria-pressed={s.theme === t} onClick={() => s.set({ theme: t })}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="label-dim mb-2">Display</legend>
        <Toggle label="Performance overlay" shortcut="P" checked={s.showPerf} onChange={(v) => s.set({ showPerf: v })} />
        <Toggle
          label="Reduce motion"
          checked={s.reducedMotion()}
          onChange={(v) => s.set({ reducedMotionOverride: v })}
        />
        {s.reducedMotionOverride !== null && (
          <button type="button" className="btn justify-start text-xs text-[var(--text-dim)]" onClick={() => s.set({ reducedMotionOverride: null })}>
            Follow system setting
          </button>
        )}
      </fieldset>
      <section>
        <h3 className="label-dim mb-2">Data &amp; credits</h3>
        <ul className="flex flex-col gap-2 text-xs text-[var(--text-dim)]">
          {credits.map((c) => (
            <li key={c.title}>
              <a className="text-[var(--text)] underline decoration-[var(--panel-border)] underline-offset-2 hover:decoration-[var(--accent)]" href={c.source} target="_blank" rel="noreferrer">
                {c.title}
              </a>
              <br />
              {c.author} ·{' '}
              <a className="underline underline-offset-2" href={c.licenseUrl} target="_blank" rel="noreferrer">
                {c.license}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

