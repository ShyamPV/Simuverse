import { useEffect } from 'react';
import { decodeShare } from '../share.ts';
import { currentShareHash } from '../shareLink.ts';
import { useApp } from '../state/store.ts';

/** How long to wait for a shared link's objects to stream in before giving up. */
const RESOLVE_TIMEOUT_MS = 20_000;

/**
 * Opens shared links (#v=1&…) and keeps the address bar pointing at the
 * current view, so copying the URL at any moment shares what you see.
 */
export function UrlSync() {
  const engine = useApp((s) => s.engine);

  useEffect(() => {
    if (!engine) return;
    const { set } = useApp.getState();
    let cancelled = false;
    let ready = false;
    let retry = 0;
    const shared = decodeShare(window.location.hash);
    if (shared) {
      if (shared.location) {
        const l = shared.location;
        set({ location: { name: l.name, latDeg: l.latDeg, lonDeg: l.lonDeg, elevation: 0, tz: l.tz, source: 'search' } });
        engine.setObserver({ name: l.name, latDeg: l.latDeg, lonDeg: l.lonDeg, elevation: 0, tz: l.tz });
      }
      // Catalogues stream in, so a referenced galaxy or star may not be known yet: retry until it is.
      const deadline = performance.now() + RESOLVE_TIMEOUT_MS;
      const attempt = () => {
        if (cancelled) return;
        if (shared.go) {
          // Object link: fly there from wherever the app opened.
          const key = engine.resolveRef(shared.view.target!);
          if (key) {
            engine.travel(key);
            ready = true;
          }
        } else if (engine.applyViewState(shared.view)) ready = true;
        if (ready) return;
        if (performance.now() > deadline) {
          ready = true;
          set({ toast: 'Part of this link could not be found' });
        } else retry = window.setTimeout(attempt, 300);
      };
      attempt();
    } else ready = true;

    const timer = window.setInterval(() => {
      const stats = useApp.getState().stats;
      if (!ready || !stats || stats.warp) return;
      const hash = currentShareHash(engine, useApp.getState().location);
      if (hash !== window.location.hash) history.replaceState(null, '', hash);
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      window.clearInterval(timer);
    };
  }, [engine]);

  return null;
}

/** Brief status messages ("Link copied"). */
export function Toast() {
  const toast = useApp((s) => s.toast);
  const set = useApp((s) => s.set);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => set({ toast: null }), 2500);
    return () => window.clearTimeout(t);
  }, [toast, set]);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-0 top-16 z-30 flex justify-center">
      {toast && <p className="glass rounded-full px-4 py-1.5 text-sm">{toast}</p>}
    </div>
  );
}
