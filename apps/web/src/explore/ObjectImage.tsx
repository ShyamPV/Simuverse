import { blackbodyRgb } from '@simuverse/astro';
import type { CatalogEntry } from '@simuverse/data';
import { useState } from 'react';

const rgb = (T: number) => {
  const [r, g, b] = blackbodyRgb(T);
  const m = Math.max(r, g, b) || 1;
  return `${Math.round((255 * r) / m)},${Math.round((255 * g) / m)},${Math.round((255 * b) / m)}`;
};

const EXO_COLORS: Record<string, string> = {
  'Hot Jupiter': '#7a4a3a', 'Gas giant': '#d6bd92', 'Neptune-like planet': '#7fa6e0', 'Hot Neptune': '#5d7fc0',
  'Sub-Neptune': '#9fc3d6', 'Super-Earth': '#a39282', 'Rocky planet': '#a39282', 'Hot rocky planet': '#7a4a3a',
};

/**
 * A picture for a catalogue entry: the survey photograph or planet map where
 * there is one, otherwise a drawn glyph (star colour from its temperature,
 * planet from its class, black holes and neutron stars stylised).
 */
export function ObjectImage({ entry, size, caption = false }: { entry: CatalogEntry; size: number; caption?: boolean }) {
  // A photo that can't load (offline and never cached) falls back to the drawn glyph.
  const [failed, setFailed] = useState(false);
  const img = failed ? undefined : entry.image;
  const box = { width: size, height: size };
  let body: React.ReactNode;
  if (img?.round) {
    body = (
      <div
        role="img"
        aria-label={entry.name}
        className="rounded-full"
        style={{
          ...box,
          backgroundImage: `url("${img.url}")`,
          backgroundSize: '200% 100%',
          backgroundPosition: '30% 50%',
          boxShadow: `inset ${-size * 0.18}px ${-size * 0.08}px ${size * 0.3}px rgba(0,0,0,0.75)`,
        }}
      />
    );
  } else if (img) {
    body = <img src={img.url} alt={entry.name} loading="lazy" decoding="async" className="rounded-lg object-cover" style={box} onError={() => setFailed(true)} />;
  } else if (entry.category === 'star' && entry.temperatureK) {
    const c = rgb(entry.temperatureK);
    body = (
      <div role="img" aria-label={`${entry.name}: a star`} className="rounded-full" style={{ ...box, background: `radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(${c},0.95) 14%, rgba(${c},0.35) 30%, rgba(${c},0) 62%)` }} />
    );
  } else if (entry.category === 'exoplanet') {
    const c = EXO_COLORS[entry.type] ?? '#a39282';
    body = (
      <div role="img" aria-label={`${entry.name}: ${entry.type}`} className="rounded-full" style={{ ...box, transform: 'scale(0.78)', background: `radial-gradient(circle at 35% 35%, ${c} 0%, ${c} 45%, #000 100%)` }} />
    );
  } else if (entry.category === 'black-hole') {
    body = (
      <div role="img" aria-label={`${entry.name}: a black hole`} className="rounded-full" style={{ ...box, background: 'radial-gradient(circle, #000 0%, #000 28%, rgba(255,170,90,0.95) 33%, rgba(255,120,40,0.4) 42%, rgba(0,0,0,0) 62%)' }} />
    );
  } else if (entry.category === 'neutron-star') {
    body = (
      <div role="img" aria-label={`${entry.name}: a neutron star`} style={{ ...box, background: 'radial-gradient(circle, #fff 0%, rgba(170,200,255,0.9) 6%, rgba(120,160,255,0) 22%), linear-gradient(60deg, transparent 47%, rgba(150,190,255,0.5) 50%, transparent 53%)' }} />
    );
  } else {
    const c = entry.category === 'galaxy' ? '220,210,255' : entry.category === 'cluster' ? '255,230,190' : '255,140,170';
    body = (
      <div role="img" aria-label={entry.name} className="rounded-lg" style={{ ...box, background: `radial-gradient(ellipse at center, rgba(${c},0.55) 0%, rgba(${c},0.12) 40%, rgba(0,0,0,0) 70%)` }} />
    );
  }
  if (!caption) return <div className="grid shrink-0 place-items-center" style={box}>{body}</div>;
  return (
    <figure className="flex flex-col items-center gap-1">
      <div className="grid place-items-center" style={box}>{body}</div>
      {img && (
        <figcaption className="text-center text-[10px] leading-snug text-[var(--text-dim)]">
          {img.round
            ? img.credit
            : `${img.credit}${img.fov ? ` · ${img.fov * 60 < 120 ? `${(img.fov * 60).toFixed(img.fov * 60 < 10 ? 1 : 0)}′` : `${img.fov.toFixed(1)}°`} wide, north up` : ''}${img.halpha ? ' · H-alpha, colours approximate' : ''}`}
        </figcaption>
      )}
    </figure>
  );
}
