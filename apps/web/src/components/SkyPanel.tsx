import { type Place, searchPlaces } from '@simuverse/data';
import type { SkyEventsResponse } from '@simuverse/engine';
import { useEffect, useId, useMemo, useState } from 'react';
import { compassPoint, formatDeg, formatLatLon } from '../format.ts';
import { placeToLocation, requestDeviceLocation } from '../location.ts';
import { useApp, useDisplayTimeZone } from '../state/store.ts';
import { formatTime, tonightStart } from '../zonedTime.ts';
import { Toggle } from './Toggle.tsx';

const DATA = `${import.meta.env.BASE_URL}data/`;
const PLANETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'] as const;
const TONIGHT_BODIES = ['sun', 'moon', ...PLANETS] as const;
const NAMES: Record<string, string> = {
  sun: 'Sun', moon: 'Moon', mercury: 'Mercury', venus: 'Venus', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn',
};
const LIGHT_POLLUTION: [number, string][] = [
  [6.5, 'Dark site'], [6.0, 'Rural'], [5.0, 'Suburban'], [4.0, 'City'], [3.0, 'Inner city'],
];

export function SkyPanel() {
  const sky = useApp((s) => s.sky);
  const setSky = useApp((s) => s.setSky);
  return (
    <div className="flex flex-col gap-5 text-sm">
      <LocationCard />
      <Tonight />
      <fieldset className="flex flex-col gap-1">
        <legend className="label-dim mb-1">Show</legend>
        <Toggle label="Constellation lines" shortcut="K" checked={sky.figures} onChange={(v) => setSky({ figures: v })} />
        <Toggle label="Constellation art" shortcut="U" checked={sky.art} onChange={(v) => setSky({ art: v })} />
        <Toggle label="Constellation names" checked={sky.names} onChange={(v) => setSky({ names: v })} />
        <Toggle label="Boundaries" shortcut="B" checked={sky.bounds} onChange={(v) => setSky({ bounds: v })} />
        <Toggle label="Ground" shortcut="G" checked={sky.ground} onChange={(v) => setSky({ ground: v })} />
        <Toggle label="Atmosphere" shortcut="A" checked={sky.atmosphere} onChange={(v) => setSky({ atmosphere: v })} />
        <Toggle label="Satellites" checked={sky.satellites} onChange={(v) => setSky({ satellites: v })} />
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="label-dim">Sky darkness</span>
        <select
          className="glass rounded-lg px-2 py-1.5 text-sm"
          value={sky.darkSkyLimit}
          onChange={(e) => setSky({ darkSkyLimit: Number(e.target.value) })}
        >
          {LIGHT_POLLUTION.map(([m, label]) => (
            <option key={m} value={m}>{`${label} (stars to mag ${m.toFixed(1)})`}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function LocationCard() {
  const location = useApp((s) => s.location);
  const set = useApp((s) => s.set);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const listId = useId();

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const handle = setTimeout(() => {
      searchPlaces(new URL(DATA, window.location.href).href, query)
        .then((r) => live && setResults(r))
        .catch(() => live && setStatus('City search is unavailable offline.'));
    }, 150);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [query]);

  const useDevice = async () => {
    setStatus('Asking your browser for your location…');
    const loc = await requestDeviceLocation();
    if (loc) {
      set({ location: loc });
      setStatus(null);
    } else setStatus('Location permission was not granted. You can search for a city instead.');
  };

  return (
    <section aria-label="Observing location" className="flex flex-col gap-2">
      <p className="label-dim">Observing from</p>
      {location ? (
        <div>
          <p className="font-medium leading-snug">{location.name}</p>
          <p className="font-mono text-[11px] text-[var(--text-dim)]">
            {formatLatLon(location.latDeg, location.lonDeg)} · {Math.round(location.elevation)} m
          </p>
          {location.source === 'timezone' && (
            <p className="mt-1 text-[11px] leading-snug text-[var(--text-dim)]">Estimated from your time zone.</p>
          )}
        </div>
      ) : (
        <p className="text-[var(--text-dim)]">Finding a default location…</p>
      )}
      {location?.source !== 'geolocation' && (
        <button type="button" className="btn justify-start border border-[var(--panel-border)]" onClick={useDevice}>
          Use my location
        </button>
      )}
      <div className="relative">
        <input
          type="search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-label="Search for a city"
          placeholder="Search for a city…"
          className="glass w-full rounded-lg px-2.5 py-1.5 text-sm placeholder:text-[var(--text-dim)]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <ul id={listId} role="listbox" className="glass absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg py-1">
            {results.map((p) => (
              <li key={`${p.name}-${p.lat}-${p.lon}`} role="option" aria-selected="false">
                <button
                  type="button"
                  className="btn w-full flex-col items-start gap-0 rounded-none text-left"
                  onClick={() => {
                    set({ location: placeToLocation(p, 'search') });
                    setQuery('');
                    setResults([]);
                  }}
                >
                  <span>{p.name}</span>
                  <span className="text-[11px] text-[var(--text-dim)]">{[p.admin, p.country].filter(Boolean).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {status && <p className="text-[11px] text-amber-300" role="status">{status}</p>}
    </section>
  );
}

/** Tonight's events for the observer: twilight, Sun, Moon, planets and ISS passes. */
function Tonight() {
  const engine = useApp((s) => s.engine);
  const location = useApp((s) => s.location);
  const simTime = useApp((s) => s.stats?.simTimeMs);
  const tz = useDisplayTimeZone();
  const [data, setData] = useState<SkyEventsResponse | null>(null);
  const start = useMemo(() => (simTime === undefined ? null : tonightStart(simTime, tz)), [simTime, tz]);

  useEffect(() => {
    if (!engine || start === null) return;
    let live = true;
    const iss = engine.satelliteTle(25544);
    const compute = () =>
      engine
        .computeSkyEvents(
          start,
          TONIGHT_BODIES.map((id) => ({ key: id, target: { kind: 'body' as const, id } })),
          true,
          iss ? [{ key: 'iss', tle: iss }] : [],
        )
        .then((r) => live && setData(r));
    void compute();
    // Satellites load a moment after the engine; retry once so the ISS appears.
    const retry = iss ? undefined : setTimeout(() => void (engine.satelliteTle(25544) && compute()), 4000);
    return () => {
      live = false;
      clearTimeout(retry);
    };
  }, [engine, start, location?.latDeg, location?.lonDeg]);

  if (!data) return <p className="text-[var(--text-dim)]">Working out tonight’s sky…</p>;
  const t = (ms?: number) => (ms === undefined ? '—' : formatTime(ms, tz));
  const tw = data.twilight;
  const darkFrom = tw?.astronomicalDusk ?? tw?.nauticalDusk;
  const darkTo = tw?.astronomicalDawn ?? tw?.nauticalDawn;
  const visiblePasses = (data.passes.iss ?? []).filter((p) => p.visible);

  return (
    <section aria-label="Tonight" className="flex flex-col gap-2">
      <p className="label-dim">Tonight{data.precise ? '' : ' (approximate)'}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-[var(--text-dim)]">Sunset</dt>
        <dd className="text-right font-mono tabular-nums">{t(data.results.sun?.set)}</dd>
        <dt className="text-[var(--text-dim)]">Dark sky</dt>
        <dd className="text-right font-mono tabular-nums">{darkFrom && darkTo ? `${t(darkFrom)}–${t(darkTo)}` : 'never fully dark'}</dd>
        <dt className="text-[var(--text-dim)]">Sunrise</dt>
        <dd className="text-right font-mono tabular-nums">{t(data.results.sun?.rise)}</dd>
        <dt className="text-[var(--text-dim)]">Moon</dt>
        <dd className="text-right text-[12px]">
          {data.moon ? `${data.moon.name}, ${Math.round(data.moon.illuminated * 100)}%` : '—'}
          <span className="block font-mono text-[11px] text-[var(--text-dim)]">
            ↑ {t(data.results.moon?.rise)} · ↓ {t(data.results.moon?.set)}
          </span>
        </dd>
      </dl>
      <ul className="flex flex-col gap-0.5 text-[13px]">
        {PLANETS.map((id) => {
          const r = data.results[id];
          if (!r) return null;
          const up = r.alwaysUp ? 'up all night' : r.alwaysDown ? 'below horizon' : `↑ ${t(r.rise)} · ↓ ${t(r.set)}`;
          return (
            <li key={id}>
              <button type="button" className="btn w-full justify-between px-1.5 py-1" onClick={() => engine?.focus(id)}>
                <span>{NAMES[id]}</span>
                <span className="font-mono text-[11px] text-[var(--text-dim)]">{up}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="text-[13px]">
        <p className="text-[var(--text-dim)]">ISS visible passes</p>
        {visiblePasses.length === 0 ? (
          <p className="text-[12px] text-[var(--text-dim)]">None tonight.</p>
        ) : (
          <ul className="font-mono text-[11px]">
            {visiblePasses.slice(0, 4).map((p) => (
              <li key={p.rise}>
                {t(p.rise)}–{t(p.set)} · max {formatDeg(p.maxAlt, 0)} · {compassPoint(p.riseAz)}→{compassPoint(p.setAz)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
