import { formatDistance } from '@simuverse/astro';
import { type CatalogEntry, bestMonth, equipmentFor, generatedFacts } from '@simuverse/data';
import { curatedInfo } from '@simuverse/data/facts';
import type { SelectionInfo } from '@simuverse/engine';
import { type ReactNode, useMemo } from 'react';
import { RiseSet, useSelectionEvents } from '../components/InfoPanel.tsx';
import { compassPoint, formatDec, formatDeg, formatRa, formatSci, lightTime } from '../format.ts';
import { useApp, useDisplayTimeZone } from '../state/store.ts';
import { formatTime } from '../zonedTime.ts';
import { useExploreStore } from './favorites.ts';
import { ObjectImage } from './ObjectImage.tsx';

const LY = 9.4607e15, AU = 1.495978707e11, R_SUN = 6.957e8, R_EARTH = 6.371e6;
const M_SUN = 1.98847e30, M_EARTH = 5.9722e24, M_JUP = 1.89819e27;

function sizeText(e: CatalogEntry): string | null {
  const r = e.radiusM;
  if (r === undefined) return null;
  switch (e.category) {
    case 'star': return `${(r / R_SUN).toPrecision(3)} × the Sun’s radius`;
    case 'black-hole': return r > 0.01 * AU ? `Event horizon ${((2 * r) / AU).toPrecision(3)} AU across` : `Event horizon ${((2 * r) / 1000).toPrecision(3)} km across`;
    case 'neutron-star': return 'About 24 km across';
    case 'exoplanet': return `${Math.round((2 * r) / 1000).toLocaleString('en-US')} km (${(r / R_EARTH).toPrecision(3)} × Earth)`;
    case 'nebula': case 'cluster': case 'galaxy': {
      const ly = (2 * r) / LY;
      return `${ly.toLocaleString('en-US', { maximumSignificantDigits: 3 })} light-years across`;
    }
    default: return `${((2 * r) / 1000).toLocaleString('en-US', { maximumSignificantDigits: 4 })} km across`;
  }
}

function massText(e: CatalogEntry): string | null {
  const m = e.massKg;
  if (m === undefined) return null;
  if (e.category === 'black-hole' || e.category === 'neutron-star') {
    const s = m / M_SUN;
    return s >= 1e9 ? `${(s / 1e9).toPrecision(3)} billion × the Sun` : s >= 1e6 ? `${(s / 1e6).toPrecision(3)} million × the Sun` : `${s.toPrecision(3)} × the Sun`;
  }
  if (e.category === 'exoplanet') return m > 50 * M_EARTH ? `${(m / M_JUP).toPrecision(3)} × Jupiter` : `${(m / M_EARTH).toPrecision(3)} × Earth`;
  return formatSci(m, 'kg');
}

/** The page for one catalogue object. */
export function Detail({ entry, onGo, onShowInSky }: { entry: CatalogEntry; onGo: () => void; onShowInSky: () => void }) {
  const engine = useApp((s) => s.engine);
  const simMinute = useApp((s) => Math.floor((s.stats?.simTimeMs ?? Date.now()) / 60_000));
  const favorites = useExploreStore((s) => s.favorites);
  const toggleFavorite = useExploreStore((s) => s.toggleFavorite);
  const set = useApp((s) => s.set);
  const fav = favorites.some((f) => f.ref === entry.ref);
  // Position now from the observer; refreshed each simulated minute.
  const info = useMemo(() => engine?.describe(entry.key) ?? null, [engine, entry.key, simMinute]);
  const curated = useMemo(() => curatedInfo([entry.name, ...entry.aliases, entry.ref]), [entry]);
  const facts = useMemo(() => {
    const generated = generatedFacts(entry);
    return [...(curated?.facts ?? []), ...generated.slice(0, curated ? 2 : 5)];
  }, [entry, curated]);
  const discovered = entry.discovered ?? curated?.discovered;

  const rows: [string, ReactNode][] = [['Type', entry.type]];
  if (entry.distanceM !== undefined) {
    rows.push(['Distance', <>{formatDistance(entry.distanceM).text}<br /><span className="text-[var(--text-dim)]">{lightTime(entry.distanceM)}</span></>]);
  }
  const size = sizeText(entry);
  if (size) rows.push(['Size', size]);
  const mass = massText(entry);
  if (mass) rows.push(['Mass', mass]);
  if (entry.luminositySun !== undefined && entry.category !== 'solar-system') {
    rows.push(['Luminosity', `${entry.luminositySun < 0.01 ? entry.luminositySun.toExponential(1) : entry.luminositySun.toLocaleString('en-US', { maximumSignificantDigits: 3 })} × the Sun`]);
  }
  if (entry.temperatureK !== undefined) rows.push([entry.category === 'exoplanet' ? 'Equilibrium temp.' : 'Temperature', `${Math.round(entry.temperatureK).toLocaleString('en-US')} K`]);
  if (entry.magnitude !== undefined && entry.category !== 'exoplanet') rows.push(['Magnitude', entry.magnitude.toFixed(1)]);
  if (discovered) rows.push(['Discovered', discovered.year ? `${discovered.year < 0 ? `${-discovered.year} BC` : discovered.year} · ${discovered.by}` : discovered.by]);
  for (const [k, v] of entry.extra ?? []) rows.push([k, v]);

  const copyLink = () => {
    const url = new URL(window.location.href);
    url.hash = `v=1&m=o&t=${encodeURIComponent(entry.ref)}&s=${encodeURIComponent(entry.ref)}&go=1`;
    void navigator.clipboard.writeText(url.href).catch(() => undefined);
    set({ toast: `Link to ${entry.name} copied` });
  };

  return (
    <article aria-labelledby="explore-detail-title" className="flex flex-col gap-4">
      <header className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <ObjectImage entry={entry} size={196} caption />
        <div className="min-w-0 flex-1">
          <p className="label-dim">{entry.type}</p>
          <h2 id="explore-detail-title" className="font-display text-3xl font-semibold tracking-tight">{entry.name}</h2>
          {entry.aliases.length > 0 && <p className="mt-0.5 text-xs text-[var(--text-dim)]">{entry.aliases.slice(0, 4).join(' · ')}</p>}
          {entry.approximate && (
            <span className="mt-1.5 inline-block rounded-full border border-amber-300/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
              some values approximate
            </span>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {(info?.travelable ?? true) && (
              <button type="button" className="btn border border-[var(--accent)]/60 bg-[var(--accent)]/15 px-3" onClick={onGo}>Go there</button>
            )}
            <button type="button" className="btn border border-[var(--panel-border)] px-3" onClick={onShowInSky}>Show in my sky</button>
            <button
              type="button"
              className="btn border border-[var(--panel-border)] px-3"
              aria-pressed={fav}
              onClick={() => void toggleFavorite(entry.ref, entry.name)}
            >
              {fav ? '★ Favourite' : '☆ Favourite'}
            </button>
            <button type="button" className="btn border border-[var(--panel-border)] px-3" onClick={copyLink}>Copy link</button>
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--text-dim)]">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {info && <WhereToFind entry={entry} info={info} />}

      {facts.length > 0 && (
        <section aria-labelledby="facts-title">
          <h3 id="facts-title" className="label-dim mb-2">Did you know?</h3>
          <ul className="flex flex-col gap-2 text-sm leading-relaxed">
            {facts.map((f) => (
              <li key={f.text} className="rounded-lg border border-[var(--panel-border)] bg-white/[0.03] px-3 py-2">
                {f.text}
                <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Source: {f.source}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** Current position, rise/set, tonight's best time, season and equipment, from the observer's location. */
function WhereToFind({ entry, info }: { entry: CatalogEntry; info: SelectionInfo }) {
  const engine = useApp((s) => s.engine);
  const simTime = useApp((s) => s.stats?.simTimeMs ?? Date.now());
  const location = useApp((s) => s.location);
  const tz = useDisplayTimeZone();
  const events = useSelectionEvents(info, simTime, tz);
  const t = (ms?: number) => (ms === undefined ? '—' : formatTime(ms, tz));
  const tonightWindow = Math.floor(simTime / 1_800_000);
  const tonight = useMemo(() => engine?.visibilityTonight([entry.key]) ?? null, [engine, entry.key, tonightWindow]);
  const best = tonight?.objects.get(entry.key);
  const equipment = equipmentFor(entry);
  const invisible = entry.category === 'exoplanet' || entry.category === 'black-hole';

  return (
    <section aria-labelledby="where-title" className="rounded-xl border border-[var(--panel-border)] bg-white/[0.03] p-3">
      <h3 id="where-title" className="label-dim mb-2">Where to find it{location ? ` · from ${location.name.split(',')[0]}` : ''}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {info.constellation && <><dt className="text-[var(--text-dim)]">Constellation</dt><dd>{info.constellation}</dd></>}
        <dt className="text-[var(--text-dim)]">RA / Dec</dt>
        <dd className="font-mono text-xs">{formatRa(info.raJ2000)} · {formatDec(info.decJ2000)} <span className="text-[var(--text-dim)]">(J2000)</span></dd>
        <dt className="text-[var(--text-dim)]">Right now</dt>
        <dd>{info.alt > 0 ? `${formatDeg(info.alt, 0)} up, towards ${compassPoint(info.az)}` : `Below the horizon (${formatDeg(info.alt, 0)})`}</dd>
        <dt className="text-[var(--text-dim)]">Tonight</dt>
        <dd>
          {!tonight ? 'No dark sky tonight at this latitude'
            : !best || best.maxAltDeg < 15 ? 'Stays too low to see well tonight'
            : `Highest at ${t(best.atMs)}, ${Math.round(best.maxAltDeg)}° up${invisible ? '' : equipment === 'Naked eye' ? ' (naked eye)' : equipment === 'Binoculars' ? ' (binoculars)' : equipment === 'Small telescope' ? ' (small telescope)' : ''}`}
        </dd>
        {entry.raDeg !== undefined && entry.category !== 'solar-system' && entry.category !== 'small-body' && (
          <><dt className="text-[var(--text-dim)]">Best season</dt><dd>{bestMonth(entry.raDeg)} (highest around midnight)</dd></>
        )}
        <dt className="text-[var(--text-dim)]">To see it</dt>
        <dd>
          {entry.category === 'exoplanet'
            ? 'Too faint and close to its star to see; its host star is shown instead'
            : entry.category === 'black-hole' ? 'Invisible: only its effect on nearby matter can be seen'
            : equipment}
        </dd>
      </dl>
      <div className="mt-3 border-t border-[var(--panel-border)] pt-2 text-sm">
        <p className="label-dim mb-1">Today</p>
        {events ? <RiseSet r={events.results.sel} t={t} /> : <p className="text-[var(--text-dim)]">Calculating…</p>}
      </div>
    </section>
  );
}
