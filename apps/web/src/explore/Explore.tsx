import { Suspense, lazy, useEffect } from 'react';
import { useApp } from '../state/store.ts';

// The catalogue page and its curated facts are only downloaded when Explore is first opened.
const ExploreContent = lazy(() => import('./ExplorePage.tsx').then((m) => ({ default: m.ExploreContent })));

export function Explore() {
  const section = useApp((s) => s.section);
  const engine = useApp((s) => s.engine);
  const open = section === 'explore';
  // Nothing of the 3D view shows behind this page: don't draw it.
  useEffect(() => {
    engine?.setSuspended(open);
    return () => engine?.setSuspended(false);
  }, [engine, open]);
  if (!open) return null;
  return (
    <Suspense fallback={<div className="absolute inset-0 z-40 grid place-items-center bg-space-950 text-[var(--text-dim)]">Loading the catalogue…</div>}>
      <ExploreContent />
    </Suspense>
  );
}
