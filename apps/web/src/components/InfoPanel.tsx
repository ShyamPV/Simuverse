import { C_MPS, formatDistance } from '@simuverse/astro';
import type { SelectionInfo, SkyEventsResponse } from '@simuverse/engine';
import { useEffect, useMemo, useState } from 'react';
import { bodyInfo } from '../bodies.ts';
import { compassPoint, formatAzimuth, formatDec, formatDeg, formatRa, visibilityClass } from '../format.ts';
import { useApp, useDisplayTimeZone } from '../state/store.ts';
import { formatTime, localMidnight, zoneAbbreviation } from '../zonedTime.ts';
import { IconClose, IconPanel } from './icons.tsx';

const KIND_LABEL: Record<string, string> = {
  star: 'Star', planet: 'Planet', moon: 'Moon', 'dwarf-planet': 'Dwarf planet', satellite: 'Satellite',
  galaxy: 'Galaxy', nebula: 'Nebula', cluster: 'Star cluster',
};

function sci(x: number, unit: string): string {
  const [m, e] = x.toExponential(3).split('e');
  return `${m} × 10${Number(e).toString().replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]!)} ${unit}`;
}

function lightTime(m: number): string {
  const s = m / C_MPS;
  if (s < 60) return `${s.toFixed(2)} light-seconds`;
  if (s < 3600) return `${(s / 60).toFixed(1)} light-minutes`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} light-hours`;
  const ly = s / 31_557_600;
  return `${ly.toLocaleString('en-US', { maximumSignificantDigits: ly < 100 ? 3 : 4 })} light-years`;
}

export function InfoPanel() {
  const stats = useApp((s) => s.stats);
  const open = useApp((s) => s.infoOpen);
  const set = useApp((s) => s.set);

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
  if (!stats) return null;
  const sel = stats.selection;
  return (
    <aside
      aria-label="Object information"
      className="glass absolute right-3 top-16 z-20 flex max-h-[calc(100vh-11rem)] w-80 flex-col overflow-hidden rounded-xl"
    >
      {sel ? <SelectionView sel={sel} /> : stats.mode === 'universe' ? <FocusView /> : <EmptySky />}
    </aside>
  );
}

function Header(props: { kind: string; name: string; color?: string; badge?: string }) {
  const set = useApp((s) => s.set);
  return (
    <div className="relative shrink-0 px-4 pb-3 pt-4">
      {props.color && (
        <div
          className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full opacity-40 blur-2xl"
          style={{ background: props.color }}
          aria-hidden="true"
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="label-dim">{props.kind}</p>
          <h2 className="truncate font-display text-2xl font-semibold tracking-tight">{props.name}</h2>
          {props.badge && (
            <span className="mt-1 inline-block rounded-full border border-amber-300/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
              {props.badge}
            </span>
          )}
        </div>
        <button type="button" className="btn p-1" onClick={() => set({ infoOpen: false })} aria-label="Hide object info">
          <IconClose size={16} />
        </button>
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-[var(--panel-border)] px-4 py-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--text-dim)]">{k}</dt>
          <dd className="text-right font-mono text-[0.78rem] tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptySky() {
  return (
    <>
      <Header kind="Sky view" name="Look around" />
      <p className="border-t border-[var(--panel-border)] px-4 py-3 text-sm leading-relaxed text-[var(--text-dim)]">
        Drag to look around and scroll to zoom. Click any star, planet or satellite to see where it is, how bright it is,
        and when it rises and sets. Zoom all the way out to leave the ground.
      </p>
    </>
  );
}

function SelectionView({ sel }: { sel: SelectionInfo }) {
  const engine = useApp((s) => s.engine);
  const mode = useApp((s) => s.stats?.mode);
  const simTime = useApp((s) => s.stats?.simTimeMs ?? Date.now());
  const location = useApp((s) => s.location);
  const tz = useDisplayTimeZone();
  const events = useSelectionEvents(sel, simTime, tz);
  const body = sel.key.startsWith('body:') ? bodyInfo(sel.key.slice(5)) : undefined;
  const t = (ms?: number) => (ms === undefined ? '—' : formatTime(ms, tz));

  const rows: [string, React.ReactNode][] = [];
  if (sel.constellation) rows.push(['Constellation', sel.constellation]);
  rows.push(['Altitude', `${formatDeg(sel.alt)}${sel.alt < 0 ? ' (below horizon)' : ''}`]);
  rows.push(['Azimuth', formatAzimuth(sel.az)]);
  rows.push(['RA / Dec (J2000)', <>{formatRa(sel.raJ2000)}<br />{formatDec(sel.decJ2000)}</>]);
  rows.push(['RA / Dec (of date)', <>{formatRa(sel.ra)}<br />{formatDec(sel.dec)}</>]);
  if (sel.distance !== undefined) {
    rows.push(['Distance', <>{formatDistance(sel.distance).text}<br /><span className="text-[var(--text-dim)]">{lightTime(sel.distance)}</span></>]);
  } else if (sel.kind === 'star') rows.push(['Distance', 'unknown (no reliable parallax)']);
  if (sel.magnitude !== undefined) {
    rows.push(['Magnitude', <>{sel.magnitude.toFixed(2)}<br /><span className="text-[var(--text-dim)]">{visibilityClass(sel.magnitude)}</span></>]);
  }
  for (const [k, v] of sel.details) rows.push([k, v]);
  if (body && sel.kind !== 'satellite') rows.push(['Radius', `${(body.radius / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 })} km`]);
  if (body) rows.push(['Mass', sci(body.mass, 'kg')]);

  return (
    <>
      <Header
        kind={sel.subtitle ?? KIND_LABEL[sel.kind] ?? sel.kind}
        name={sel.name}
        color={body?.color}
        badge={sel.approximate ? 'approximate' : undefined}
      />
      <div className="min-h-0 overflow-y-auto">
        <Rows rows={rows} />
        <section className="border-t border-[var(--panel-border)] px-4 py-3 text-sm" aria-label="Rise and set">
          <p className="label-dim mb-1.5">
            {sel.kind === 'satellite' ? 'Next passes' : 'Today'} · {zoneAbbreviation(simTime, tz)}
          </p>
          {!events ? (
            <p className="text-[var(--text-dim)]">Calculating…</p>
          ) : sel.kind === 'satellite' ? (
            <PassList passes={events.passes.sat ?? []} t={t} />
          ) : (
            <RiseSet r={events.results.sel} t={t} />
          )}
          {location && <p className="mt-2 text-[11px] text-[var(--text-dim)]">As seen from {location.name}</p>}
        </section>
      </div>
      <div className="flex shrink-0 gap-2 border-t border-[var(--panel-border)] p-3">
        {mode === 'sky' ? (
          <button type="button" className="btn flex-1 border border-[var(--panel-border)]" onClick={() => engine?.centerOnSelection()}>
            Center in view
          </button>
        ) : (
          sel.travelable && (
            <button
              type="button"
              className="btn flex-1 border border-[var(--panel-border)]"
              onClick={() => engine?.focus(body ? body.id : sel.key)}
            >
              Go there
            </button>
          )
        )}
        <button type="button" className="btn border border-[var(--panel-border)]" onClick={() => engine?.select(null)}>
          Clear
        </button>
      </div>
    </>
  );
}

function RiseSet({ r, t }: { r?: SkyEventsResponse['results'][string]; t: (ms?: number) => string }) {
  if (!r) return <p className="text-[var(--text-dim)]">—</p>;
  if (r.alwaysUp) return <p>Above the horizon all day (circumpolar today).</p>;
  if (r.alwaysDown) return <p>Doesn’t rise today from here.</p>;
  return (
    <dl className="grid grid-cols-3 gap-2 text-center">
      {([['Rise', r.rise], ['Transit', r.transit], ['Set', r.set]] as const).map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11px] text-[var(--text-dim)]">{k}</dt>
          <dd className="font-mono tabular-nums">{t(v)}</dd>
        </div>
      ))}
      {r.transitAlt !== undefined && (
        <p className="col-span-3 text-[11px] text-[var(--text-dim)]">Highest at {formatDeg(r.transitAlt, 0)} altitude</p>
      )}
    </dl>
  );
}

function PassList({ passes, t }: { passes: SkyEventsResponse['passes'][string]; t: (ms?: number) => string }) {
  if (passes.length === 0) return <p className="text-[var(--text-dim)]">No passes in the next 24 hours.</p>;
  return (
    <ul className="flex flex-col gap-1 font-mono text-[12px]">
      {passes.slice(0, 6).map((p) => (
        <li key={p.rise} className={p.visible ? '' : 'text-[var(--text-dim)]'}>
          {t(p.rise)}–{t(p.set)} · {formatDeg(p.maxAlt, 0)} · {compassPoint(p.riseAz)}→{compassPoint(p.setAz)}
          {p.visible ? ' · visible' : ''}
        </li>
      ))}
    </ul>
  );
}

/** Rise/transit/set for the selection's local day, or satellite passes for the next 24 h. */
function useSelectionEvents(sel: SelectionInfo, simTime: number, tz: string): SkyEventsResponse | null {
  const engine = useApp((s) => s.engine);
  const location = useApp((s) => s.location);
  const [data, setData] = useState<SkyEventsResponse | null>(null);
  const isSat = sel.kind === 'satellite';
  // Recompute when the local day changes (or, for satellites, every 10 minutes).
  const windowStart = useMemo(
    () => (isSat ? Math.floor(simTime / 600_000) * 600_000 : localMidnight(simTime, tz)),
    [isSat, simTime, tz],
  );
  const targetKey = sel.key;

  useEffect(() => {
    setData(null);
    if (!engine) return;
    let live = true;
    const p = isSat
      ? engine.computeSkyEvents(windowStart, [], false, sel.tle ? [{ key: 'sat', tle: sel.tle }] : [])
      : sel.target
        ? engine.computeSkyEvents(windowStart, [{ key: 'sel', target: sel.target }])
        : null;
    void p?.then((r) => live && setData(r));
    return () => {
      live = false;
    };
    // sel.target/tle are stable for a given key; recompute on key, day or location changes.
  }, [engine, targetKey, windowStart, location?.latDeg, location?.lonDeg]);
  return data;
}

const REGION_BLURB: Record<string, string> = {
  galaxy: 'Our galaxy: a barred spiral about 30 kpc across with some 100–400 billion stars. The Sun orbits 8.2 kpc from its centre. Seen from outside, it is shown as a volumetric model (approximate); from near the Sun, by Gaia data.',
  'local-group': 'About 100 galaxies within ~1.5 Mpc, dominated by the Milky Way and Andromeda, which will merge in roughly 4–5 billion years.',
  virgo: 'The Virgo Cluster (centred near M87, ~16.5 Mpc away) sits at the heart of the Local (Virgo) Supercluster.',
  laniakea: 'Laniakea, "immeasurable heaven", is the ~160 Mpc supercluster containing the Milky Way, defined by galaxy flows (Tully et al. 2014). Centred near the Great Attractor.',
  universe: 'Real galaxies (2MRS) are shown out to ~250 Mpc. Beyond that the cosmic web is procedural (approximate), out to the comoving horizon at ~14.3 Gpc. The faint shell marks the cosmic microwave background (stylised).',
};

/** Universe mode, nothing selected: the focused body or region. */
function FocusView() {
  const stats = useApp((s) => s.stats)!;
  const info = bodyInfo(stats.focusId);
  if (!info) {
    return (
      <>
        <Header kind="Region" name={stats.focusName} />
        <Rows rows={[['Distance from you', formatDistance(stats.distance, 'pc').text], ['Distance from the Sun', formatDistance(stats.distanceFromSun, 'pc').text]]} />
        {REGION_BLURB[stats.focusId] && (
          <p className="border-t border-[var(--panel-border)] px-4 py-3 text-[12px] leading-relaxed text-[var(--text-dim)]">{REGION_BLURB[stats.focusId]}</p>
        )}
      </>
    );
  }
  const rows: [string, React.ReactNode][] = [
    ['Distance from you', formatDistance(stats.distance).text],
    ['Altitude', formatDistance(stats.altitude).text],
    ...(info.id !== 'sun' ? [['From the Sun', formatDistance(stats.focusFromSun).text] as [string, string]] : []),
    ...(info.id !== 'earth' ? [['From Earth', formatDistance(stats.focusFromEarth).text] as [string, string]] : []),
    ['Equatorial radius', `${(info.radius / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 })} km`],
    ['Mass', sci(info.mass, 'kg')],
  ];
  return (
    <>
      <Header kind={KIND_LABEL[info.kind] ?? info.kind} name={info.name} color={info.color} badge={stats.precise ? undefined : 'approximate'} />
      <Rows rows={rows} />
      <p className="border-t border-[var(--panel-border)] px-4 py-2 text-[11px] leading-snug text-[var(--text-dim)]">
        {stats.precise
          ? 'Positions: JPL DE440 (Chebyshev fit, sub-arcsecond).'
          : 'Outside 1900–2100: positions from Keplerian elements (arcminute accuracy).'}
      </p>
    </>
  );
}
