import type { Engine, SearchHit, SearchKind } from '@simuverse/engine';
import { type KeyboardEvent, type MouseEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { copyShareLink } from '../shareLink.ts';
import { useApp } from '../state/store.ts';
import { IconDice, IconSearch } from './icons.tsx';

const KIND_LABEL: Record<SearchKind, string> = {
  body: 'Solar System', moon: 'Moon', star: 'Star', galaxy: 'Galaxy', nebula: 'Nebula', cluster: 'Cluster',
  exoplanet: 'Exoplanet', system: 'Planet host', satellite: 'Satellite', constellation: 'Constellation', region: 'Place',
  'small-body': 'Asteroid · comet', 'black-hole': 'Black hole', 'neutron-star': 'Neutron star',
};

interface Command {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  run: (engine: Engine) => void;
}

/** Things worth showing before anything is typed. */
const SUGGESTED = ['Andromeda Galaxy', 'Orion Nebula', 'Saturn', 'TRAPPIST-1', 'Alpha Centauri', 'Titan', 'Pleiades', 'Crab Nebula'];

/** Kinds that only make sense in the observer's sky. */
const SKY_ONLY = new Set<SearchKind>(['satellite', 'constellation']);

type Option = { type: 'command'; command: Command } | { type: 'hit'; hit: SearchHit };

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const engine = useApp((s) => s.engine);
  const mode = useApp((s) => s.stats?.mode ?? 'sky');
  const nav = useApp((s) => s.stats?.nav ?? 'orbit');
  const set = useApp((s) => s.set);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQuery('');
      setActive(0);
      d.showModal();
      input.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => set({ paletteOpen: false });
  const toast = (msg: string) => set({ toast: msg });

  const commands: Command[] = useMemo(() => [
    { id: 'surprise', label: 'Surprise me', hint: 'R', keywords: 'random surprise somewhere', run: (e) => e.surprise() },
    {
      id: 'fly', label: nav === 'fly' ? 'Leave free flight' : 'Free flight', hint: 'F', keywords: 'fly flight wasd free camera',
      run: (e) => e.setNavMode(e.navMode === 'fly' ? 'orbit' : 'fly'),
    },
    { id: 'sky', label: 'Sky view from my location', keywords: 'sky ground horizon tonight', run: (e) => e.enterSky() },
    {
      id: 'link', label: 'Copy link to this view', keywords: 'share link url copy',
      run: (e) => void copyShareLink(e, useApp.getState().location).then(() => toast('Link copied')),
    },
    { id: 'now', label: 'Jump to now', hint: 'N', keywords: 'time now live reset', run: (e) => e.time.resetToNow() },
    {
      id: 'shot', label: 'Save screenshot', hint: 'C', keywords: 'screenshot image png save',
      run: () => document.querySelector<HTMLButtonElement>('[aria-label="Save screenshot"]')?.click(),
    },
  ], [nav]);

  const options: Option[] = useMemo(() => {
    if (!engine || !open) return [];
    const q = query.trim().toLowerCase();
    if (!q) {
      const picks = SUGGESTED.map((n) => engine.search(n, 1)[0]).filter((h): h is SearchHit => !!h);
      return [...commands.slice(0, 3).map((command) => ({ type: 'command' as const, command })), ...picks.map((hit) => ({ type: 'hit' as const, hit }))];
    }
    // Commands match at the start of a word ("sky", "fly"), never mid-word ("io" ≠ "location").
    const words = (c: Command) => `${c.label} ${c.keywords}`.toLowerCase().split(/\s+/);
    const cmds = commands.filter((c) => words(c).some((w) => w.startsWith(q)));
    const hits = engine.search(query, 40);
    return [...cmds.map((command) => ({ type: 'command' as const, command })), ...hits.map((hit) => ({ type: 'hit' as const, hit }))];
  }, [engine, open, query, commands]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const run = (o: Option | undefined, alternate: boolean) => {
    if (!engine || !o) return;
    close();
    if (o.type === 'command') {
      o.command.run(engine);
      return;
    }
    const { key, kind } = o.hit.entry;
    // Primary action: in Sky view show it in the sky, in Universe view go there. Shift swaps them.
    const sky = SKY_ONLY.has(kind) || (mode === 'sky') !== alternate;
    if (kind === 'region') engine.focus(key);
    else if (sky) engine.showInSky(key);
    else engine.travel(key);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, options.length - 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(options.length - 1);
    else if (e.key === 'Enter') run(options[active], e.shiftKey);
    else return;
    e.preventDefault();
  };

  const primary = mode === 'sky' ? 'Show in sky' : 'Go there';
  const secondary = mode === 'sky' ? 'go there' : 'show in sky';

  return (
    <dialog
      ref={dialog}
      aria-label="Search and go"
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      className="glass mx-auto mt-[12vh] mb-auto w-[min(40rem,calc(100vw-2rem))] rounded-2xl p-0 text-[var(--text)] backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-4 py-3">
        <IconSearch className="shrink-0 text-[var(--text-dim)]" />
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
          aria-label="Search planets, moons, stars, exoplanets, nebulae and galaxies"
          placeholder="Search planets, moons, stars, exoplanets, nebulae, galaxies…"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--text-dim)]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" className="btn shrink-0 gap-1.5 px-2 py-1 text-xs" onClick={() => run({ type: 'command', command: commands[0]! }, false)}>
          <IconDice size={15} /> Surprise me
        </button>
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
        {options.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-[var(--text-dim)]">{engine ? 'Nothing found.' : 'Loading…'}</li>
        )}
        {options.map((o, i) => {
          const selected = i === active;
          const common = {
            id: `${listId}-${i}`,
            role: 'option' as const,
            'aria-selected': selected,
            onMouseMove: () => setActive(i),
            onClick: (e: MouseEvent) => run(o, e.shiftKey),
            className: `flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${selected ? 'bg-[var(--accent)]/20' : ''}`,
          };
          if (o.type === 'command') {
            return (
              <li key={`c:${o.command.id}`} {...common}>
                <span className="w-24 shrink-0 text-[11px] uppercase tracking-wide text-[var(--accent-2)]">Action</span>
                <span className="flex-1">{o.command.label}</span>
                {o.command.hint && <kbd className="kbd">{o.command.hint}</kbd>}
              </li>
            );
          }
          const { entry, matched } = o.hit;
          return (
            <li key={entry.key} {...common}>
              <span className="w-24 shrink-0 text-[11px] uppercase tracking-wide text-[var(--text-dim)]">{KIND_LABEL[entry.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {entry.name}
                  {matched !== entry.name && <span className="text-[var(--text-dim)]"> · {matched}</span>}
                </span>
                {entry.detail && <span className="block truncate text-xs text-[var(--text-dim)]">{entry.detail}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="flex justify-between gap-3 border-t border-[var(--panel-border)] px-4 py-2 text-xs text-[var(--text-dim)]">
        <span><kbd className="kbd">↵</kbd> {primary.toLowerCase()} · <kbd className="kbd">⇧</kbd><kbd className="kbd">↵</kbd> {secondary}</span>
        <span><kbd className="kbd">Esc</kbd> close</span>
      </p>
    </dialog>
  );
}
