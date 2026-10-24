import { formatDistance } from '@simuverse/astro';
import { CATEGORY_LABEL, type CatalogCategory, type CatalogEntry } from '@simuverse/data';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconClose, IconSearch } from '../components/icons.tsx';
import { useApp, useDisplayTimeZone } from '../state/store.ts';
import { formatTime } from '../zonedTime.ts';
import { Detail } from './Detail.tsx';
import { useExploreStore } from './favorites.ts';
import {
  SORT_LABEL, type SortKey, closest, extremes, featuredOfDay, filterCategory, sortEntries, tonightCandidates,
} from './lists.ts';
import { ObjectImage } from './ObjectImage.tsx';
import { Starfield } from './Starfield.tsx';
import { VirtualList } from './VirtualList.tsx';

type Tab = 'highlights' | 'all' | CatalogCategory | 'tonight' | 'closest' | 'extremes' | 'favorites' | 'visited';

const LISTS: { id: Tab; label: string }[] = [
  { id: 'highlights', label: 'Highlights' },
  { id: 'tonight', label: 'Visible tonight' },
  { id: 'closest', label: 'Closest' },
  { id: 'extremes', label: 'Most extreme' },
  { id: 'favorites', label: '★ Favourites' },
  { id: 'visited', label: 'Visited' },
];
const CATEGORIES = Object.keys(CATEGORY_LABEL) as CatalogCategory[];
const ROW = 58;

interface Row {
  entry: CatalogEntry;
  caption?: string;
}

/** Full-page catalogue of everything in Simuverse, over an animated starfield. */
export function ExplorePage() {
  const section = useApp((s) => s.section);
  const engine = useApp((s) => s.engine);
  const open = section === 'explore';
  // Nothing of the 3D view shows behind this page: don't draw it.
  useEffect(() => {
    engine?.setSuspended(open);
    return () => engine?.setSuspended(false);
  }, [engine, open]);
  return open ? <ExploreContent /> : null;
}

function ExploreContent() {
  const engine = useApp((s) => s.engine);
  const set = useApp((s) => s.set);
  const tz = useDisplayTimeZone();
  const favorites = useExploreStore((s) => s.favorites);
  const visits = useExploreStore((s) => s.visits);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [tab, setTab] = useState<Tab>('highlights');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('relevance');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tonight, setTonight] = useState<Row[] | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  // Catalogues stream in for a few seconds after start-up; pick up each new version.
  useEffect(() => {
    if (!engine) return;
    const load = () => setEntries(engine.catalog());
    load();
    const timer = window.setInterval(load, 2500);
    return () => window.clearInterval(timer);
  }, [engine]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const byRef = useMemo(() => new Map(entries.map((e) => [e.ref, e])), [entries]);
  const featured = useMemo(() => featuredOfDay(entries, new Date()), [entries]);

  // "Visible tonight" is computed on demand (a few hundred objects × the night).
  useEffect(() => {
    if (tab !== 'tonight' || !engine || !entries.length) return;
    setTonight(null);
    const id = window.setTimeout(() => {
      const cands = tonightCandidates(entries);
      const vis = engine.visibilityTonight(cands.map((e) => e.key));
      if (!vis) {
        setTonight([]);
        return;
      }
      const rows = cands
        .map((e) => ({ e, v: vis.objects.get(e.key) }))
        .filter((x) => x.v && x.v.maxAltDeg >= 20)
        .sort((a, b) => (a.e.magnitude ?? 99) - (b.e.magnitude ?? 99))
        .map(({ e, v }) => ({ entry: e, caption: `best ${formatTime(v!.atMs, tz)}, ${Math.round(v!.maxAltDeg)}° up` }));
      setTonight(rows);
    }, 30);
    return () => window.clearTimeout(id);
  }, [tab, engine, entries, tz]);

  const rows: Row[] = useMemo(() => {
    const q = query.trim();
    const inCategory = CATEGORIES.includes(tab as CatalogCategory) ? (tab as CatalogCategory) : null;
    if (q && engine) {
      const hits = engine.search(q, 400).map((h) => byKey.get(h.entry.key)).filter((e): e is CatalogEntry => !!e);
      const filtered = inCategory ? filterCategory(hits, inCategory) : hits;
      return (sort === 'relevance' ? filtered : sortEntries(filtered, sort)).map((entry) => ({ entry }));
    }
    switch (tab) {
      case 'highlights': return sortEntries(entries.filter((e) => e.rank < 12 && e.key !== 'body:earth'), 'relevance').map((entry) => ({ entry }));
      case 'all': return sortEntries(entries, sort).map((entry) => ({ entry }));
      case 'tonight': return tonight ?? [];
      case 'closest': return closest(entries);
      case 'extremes': return extremes(entries);
      case 'favorites': return favorites.map((f) => byRef.get(f.ref)).filter((e): e is CatalogEntry => !!e).map((entry) => ({ entry }));
      case 'visited': return visits.flatMap((v): Row[] => {
        const e = byRef.get(v.ref) ?? byKey.get(`body:${v.ref}`);
        if (!e) return [];
        return [v.count > 1 ? { entry: e, caption: `${v.count} visits` } : { entry: e }];
      });
      default: return sortEntries(filterCategory(entries, tab), sort).map((entry) => ({ entry }));
    }
  }, [tab, query, sort, entries, engine, byKey, byRef, tonight, favorites, visits]);

  const selectedIndex = rows.findIndex((r) => r.entry.key === selectedKey);
  const selected = (selectedKey ? byKey.get(selectedKey) : undefined) ?? featured;

  const close = () => set({ section: engine?.viewMode === 'sky' ? 'sky' : 'universe' });
  const go = (e: CatalogEntry) => {
    set({ section: 'universe' });
    engine?.travel(e.key);
  };
  const showInSky = (e: CatalogEntry) => {
    set({ section: 'sky' });
    engine?.showInSky(e.key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !useApp.getState().paletteOpen) {
        if (target === searchBox.current && query) setQuery('');
        else close();
      } else if (e.key === '/' && target?.tagName !== 'INPUT') {
        e.preventDefault();
        searchBox.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const showSort = !!query.trim() || tab === 'all' || CATEGORIES.includes(tab as CatalogCategory);
  const listLabel = query.trim() ? `Results for “${query.trim()}”` : LISTS.find((l) => l.id === tab)?.label ?? CATEGORY_LABEL[tab as CatalogCategory] ?? 'All objects';

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="explore-title" className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-space-950">
      <Starfield />
      <header className="relative flex flex-wrap items-center gap-3 border-b border-[var(--panel-border)] bg-black/30 px-5 py-3 backdrop-blur">
        <h1 id="explore-title" className="font-display text-xl font-semibold tracking-tight">Explore</h1>
        <p className="hidden text-xs text-[var(--text-dim)] md:block">{entries.length.toLocaleString('en-US')} objects</p>
        <label className="glass ml-auto flex min-w-64 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 md:max-w-md">
          <IconSearch size={16} className="text-[var(--text-dim)]" />
          <span className="sr-only">Search the catalogue</span>
          <input
            ref={searchBox}
            type="search"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-dim)]"
            placeholder="Search by name or designation (M31, Sirius, TRAPPIST-1…)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedKey(null);
            }}
          />
        </label>
        {showSort && (
          <label className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
            Sort
            <select className="glass rounded-lg px-2 py-1.5 text-sm text-[var(--text)]" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn border border-[var(--panel-border)] px-3" onClick={close} aria-label="Close Explore and return to the 3D view">
          <IconClose size={16} /> <span className="hidden sm:inline">Back to the 3D view</span>
        </button>
      </header>

      <nav aria-label="Catalogue lists" className="relative flex gap-1.5 overflow-x-auto border-b border-[var(--panel-border)] bg-black/20 px-5 py-2">
        {[...LISTS, { id: 'all' as Tab, label: 'All' }, ...CATEGORIES.map((c) => ({ id: c as Tab, label: CATEGORY_LABEL[c] }))].map((l) => (
          <button
            key={l.id}
            type="button"
            className={`btn shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs ${tab === l.id ? 'is-active border-[var(--accent)]/60' : 'border-[var(--panel-border)]'}`}
            aria-pressed={tab === l.id}
            onClick={() => {
              setTab(l.id);
              setSelectedKey(null);
            }}
          >
            {l.label}
          </button>
        ))}
      </nav>

      <div className="relative flex min-h-0 flex-1">
        <section aria-label={listLabel} className="flex w-[min(26rem,45vw)] shrink-0 flex-col border-r border-[var(--panel-border)] bg-black/25">
          <p className="border-b border-[var(--panel-border)] px-4 py-2 text-xs text-[var(--text-dim)]">
            {listLabel} · {tab === 'tonight' && !tonight && !query ? 'calculating…' : `${rows.length.toLocaleString('en-US')} objects`}
          </p>
          <div className="min-h-0 flex-1">
            <VirtualList
              items={rows}
              rowHeight={ROW}
              selected={selectedIndex}
              onSelect={(i) => setSelectedKey(rows[i]?.entry.key ?? null)}
              onActivate={(i) => rows[i] && go(rows[i]!.entry)}
              itemKey={(r) => r.entry.key}
              label={listLabel}
              empty={tab === 'favorites' ? 'Star objects to keep them here.' : tab === 'visited' ? 'Places you travel to appear here.' : tab === 'tonight' && !tonight ? 'Calculating…' : 'Nothing found.'}
              render={(r) => <ListRow row={r} />}
            />
          </div>
        </section>
        <section aria-label="Object details" className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {!selectedKey && featured && selected === featured && !query && (
            <p className="label-dim mb-3">Featured today</p>
          )}
          {selected ? (
            <Detail key={selected.key} entry={selected} onGo={() => go(selected)} onShowInSky={() => showInSky(selected)} />
          ) : (
            <p className="text-[var(--text-dim)]">Loading the catalogue…</p>
          )}
        </section>
      </div>
    </div>
  );
}

function ListRow({ row }: { row: Row }) {
  const e = row.entry;
  return (
    <div className="flex h-full items-center gap-3 px-3">
      <ObjectImage entry={e} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{e.name}</p>
        <p className="truncate text-xs text-[var(--text-dim)]">{row.caption ?? e.type}</p>
      </div>
      <div className="shrink-0 text-right font-mono text-[11px] text-[var(--text-dim)] tabular-nums">
        {e.distanceM !== undefined && <p>{formatDistance(e.distanceM).text}</p>}
        {e.magnitude !== undefined && e.category !== 'exoplanet' && <p>mag {e.magnitude.toFixed(1)}</p>}
      </div>
    </div>
  );
}
