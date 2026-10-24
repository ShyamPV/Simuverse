import { Engine } from '@simuverse/engine';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.ts';

const BASE = import.meta.env.BASE_URL;

/** Full-screen 3D canvas. Owns the Engine's lifetime and pushes settings into it. */
export function UniverseView() {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const engine = useApp((s) => s.engine);
  const quality = useApp((s) => s.quality);
  const adaptiveResolution = useApp((s) => s.adaptiveResolution);
  const lensFlare = useApp((s) => s.lensFlare);
  const showLabels = useApp((s) => s.showLabels);
  const showOrbits = useApp((s) => s.showOrbits);
  const reducedMotionOverride = useApp((s) => s.reducedMotionOverride);
  const location = useApp((s) => s.location);
  const sky = useApp((s) => s.sky);
  const deep = useApp((s) => s.deep);

  useEffect(() => {
    const { set, reducedMotion, quality: q, adaptiveResolution: adaptive, lensFlare: flare, location: loc, sky: skyOptions } = useApp.getState();
    // A fresh canvas per mount keeps StrictMode's double-mount from sharing a GL context.
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 block h-full w-full touch-none outline-none';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D view. Drag to look around, scroll to zoom, click an object to select it.');
    host.current!.prepend(canvas);

    let instance: Engine;
    try {
      instance = new Engine({
        canvas,
        overlay: overlay.current!,
        dataBaseUrl: `${BASE}data/`,
        textureBaseUrl: `${BASE}textures/planets/`,
        quality: q,
        adaptiveResolution: adaptive,
        lensFlare: flare,
        reducedMotion: reducedMotion(),
        observer: loc ?? undefined,
        skyOptions,
        mode: 'sky',
      });
    } catch (err) {
      console.error(err);
      setError('WebGL 2 is not available in this browser, so the 3D view cannot start.');
      canvas.remove();
      return;
    }
    const offStats = instance.onStats((stats) => set({ stats }));
    const offMode = instance.onModeChange((m) => {
      const section = useApp.getState().section;
      if (m === 'sky' && section === 'universe') set({ section: 'sky' });
      if (m === 'universe' && section === 'sky') set({ section: 'universe' });
    });
    set({ engine: instance });
    // Development builds only: a console/automation handle (not present in production bundles).
    if (import.meta.env.DEV) (window as unknown as { __simuverse?: Engine }).__simuverse = instance;
    canvas.focus({ preventScroll: true });
    return () => {
      offStats();
      offMode();
      instance.dispose();
      canvas.remove();
      set({ engine: null, stats: null });
    };
  }, []);

  useEffect(() => engine?.setQuality(quality), [engine, quality]);
  useEffect(() => engine?.setAdaptiveResolution(adaptiveResolution), [engine, adaptiveResolution]);
  useEffect(() => engine?.setLensFlare(lensFlare), [engine, lensFlare]);
  useEffect(() => engine?.setLabelsVisible(showLabels), [engine, showLabels]);
  useEffect(() => engine?.setOrbitsVisible(showOrbits), [engine, showOrbits]);
  useEffect(() => engine?.setSkyOptions(sky), [engine, sky]);
  useEffect(() => engine?.setDeepSkyOptions(deep), [engine, deep]);
  useEffect(() => {
    if (engine && location) engine.setObserver(location);
  }, [engine, location]);
  useEffect(() => {
    if (!engine) return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => engine.setReducedMotion(reducedMotionOverride ?? mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [engine, reducedMotionOverride]);

  return (
    <div ref={host} className="absolute inset-0">
      <div ref={overlay} className="pointer-events-none absolute inset-0" />
      {error && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center">
          <p className="glass max-w-md rounded-xl p-6">{error}</p>
        </div>
      )}
    </div>
  );
}
