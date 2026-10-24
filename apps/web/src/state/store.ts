import type { Engine, EngineStats, QualityPreset } from '@simuverse/engine';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Theme = 'default' | 'night' | 'contrast';
export type NavSection = 'universe' | 'sky' | 'explore' | 'settings';

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Settings {
  quality: QualityPreset;
  showLabels: boolean;
  showOrbits: boolean;
  showPerf: boolean;
  theme: Theme;
  /** null = follow the OS `prefers-reduced-motion` setting. */
  reducedMotionOverride: boolean | null;
  navOpen: boolean;
}

interface AppState extends Settings {
  engine: Engine | null;
  stats: EngineStats | null;
  section: NavSection;
  helpOpen: boolean;
  infoOpen: boolean;
  set: (patch: Partial<AppState>) => void;
  reducedMotion: () => boolean;
}

// localStorage can throw (private mode, blocked storage); settings then just don't persist.
const safeStorage = createJSONStorage<Settings>(() => {
  try {
    const s = window.localStorage;
    s.getItem('probe');
    return s;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
});

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      engine: null,
      stats: null,
      section: 'universe',
      helpOpen: false,
      infoOpen: true,
      quality: 'high',
      showLabels: true,
      showOrbits: true,
      showPerf: false,
      theme: 'default',
      reducedMotionOverride: null,
      navOpen: true,
      set: (patch) => set(patch),
      reducedMotion: () => get().reducedMotionOverride ?? prefersReducedMotion(),
    }),
    {
      name: 'simuverse.settings.v1',
      storage: safeStorage,
      partialize: (s): Settings => ({
        quality: s.quality,
        showLabels: s.showLabels,
        showOrbits: s.showOrbits,
        showPerf: s.showPerf,
        theme: s.theme,
        reducedMotionOverride: s.reducedMotionOverride,
        navOpen: s.navOpen,
      }),
    },
  ),
);
