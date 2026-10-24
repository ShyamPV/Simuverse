import { useEffect, useRef } from 'react';
import { useApp } from '../state/store.ts';
import { IconClose } from './icons.tsx';

const GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: 'Navigate',
    items: [
      [['Drag'], 'Look around (Sky) / orbit (Universe)'],
      [['Scroll'], 'Zoom; zoom out fully in Sky to lift off'],
      [['←', '→', '↑', '↓'], 'Turn (hold Shift for bigger steps)'],
      [['+', '−'], 'Zoom in / out'],
      [['Click'], 'Select an object'],
      [['Double-click'], 'Centre / go to the selection'],
      [['Esc'], 'Clear selection'],
      [['0'], 'Sun'],
      [['1–8'], 'Mercury … Neptune'],
      [['9'], 'Moon'],
    ],
  },
  {
    title: 'Travel',
    items: [
      [['Ctrl', 'K'], 'Search and go (also /)'],
      [['R'], 'Surprise me'],
      [['F'], 'Free flight on / off'],
      [['W', 'A', 'S', 'D'], 'Fly forward, left, back, right'],
      [['Q', 'E'], 'Fly down / up'],
      [['Shift'], 'Boost (in flight)'],
      [['Scroll'], 'Flight speed (in flight)'],
    ],
  },
  {
    title: 'Sky',
    items: [
      [['K'], 'Constellation lines'],
      [['U'], 'Constellation art'],
      [['B'], 'Constellation boundaries'],
      [['G'], 'Ground'],
      [['A'], 'Atmosphere'],
    ],
  },
  {
    title: 'Time',
    items: [
      [['Space'], 'Pause / play'],
      [['['], 'Slower, then reverse'],
      [[']'], 'Faster'],
      [['N'], 'Jump to now'],
    ],
  },
  {
    title: 'View',
    items: [
      [['L'], 'Toggle labels'],
      [['O'], 'Toggle orbits'],
      [['I'], 'Toggle object info'],
      [['P'], 'Performance overlay'],
      [['C'], 'Save screenshot'],
      [['?'], 'This help'],
    ],
  },
];

export function HelpOverlay() {
  const open = useApp((s) => s.helpOpen);
  const set = useApp((s) => s.set);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="help-title"
      onClose={() => set({ helpOpen: false })}
      onClick={(e) => e.target === dialog.current && set({ helpOpen: false })}
      className="glass m-auto w-[min(46rem,calc(100vw-2rem))] rounded-2xl p-0 text-[var(--text)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-5 py-3">
        <h2 id="help-title" className="font-display text-lg font-semibold">Keyboard shortcuts</h2>
        <button type="button" className="btn p-1" onClick={() => set({ helpOpen: false })} aria-label="Close">
          <IconClose size={16} />
        </button>
      </div>
      <div className="grid gap-6 p-5 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="label-dim mb-2">{g.title}</h3>
            <dl className="flex flex-col gap-1.5 text-sm">
              {g.items.map(([keys, what]) => (
                <div key={what} className="flex items-baseline justify-between gap-3">
                  <dt className="flex shrink-0 gap-1">{keys.map((k) => <kbd key={k} className="kbd">{k}</kbd>)}</dt>
                  <dd className="text-right text-[var(--text-dim)]">{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
