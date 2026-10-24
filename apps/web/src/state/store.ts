import { DEFAULT_SKY_OPTIONS, type Engine, type EngineStats, type ObserverLocation, type QualityPreset, type SkyOptions } from '@simuverse/engine';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Theme = 'default' | 'night' | 'contrast';
export type NavSection = 'universe' | 'sky' | 'explore' | 'settings';

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface SavedLocation extends ObserverLocation {
  /** How the location was chosen: permission-free default, device geolocation, or search. */
  source: 'timezone' | 'geolocation' | 'search';
}

/** Deep-sky layer toggles (Universe panel). */
export interface DeepOptions {
  galaxies: boolean;
  deepSky: boolean;
  milkyWay: boolean;
}

export const DEFAULT_DEEP_OPTIONS: DeepOptions = { galaxies: true, deepSky: true, milkyWay: true };

interface Settings {
  quality: QualityPreset;
  /** Lower the resolution automatically to hold the frame rate. */
  adaptiveResolution: boolean;
  lensFlare: boolean;
  showLabels: boolean;
  showOrbits: boolean;
  showPerf: boolean;
  theme: Theme;
  /** null = follow the OS `prefers-reduced-motion` setting. */
  reducedMotionOverride: boolean | null;
  navOpen: boolean;
  location: SavedLocation | null;
  sky: SkyOptions;
  deep: DeepOptions;
}

interface AppState extends Settings {
  engine: Engine | null;
  stats: EngineStats | null;
  section: NavSection;
  helpOpen: boolean;
  infoOpen: boolean;
  paletteOpen: boolean;
  /** Short status message (e.g. "Link copied"), cleared after a few seconds. */
  toast: string | null;
  set: (patch: Partial<AppState>) => void;
  setSky: (patch: Partial<SkyOptions>) => void;
  setDeep: (patch: Partial<DeepOptions>) => void;
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
      section: 'sky',
      helpOpen: false,
      infoOpen: true,
      paletteOpen: false,
      toast: null,
      quality: 'high',
      adaptiveResolution: true,
      lensFlare: false,
      showLabels: true,
      showOrbits: true,
      showPerf: false,
      theme: 'default',
      reducedMotionOverride: null,
      navOpen: true,
      location: null,
      sky: DEFAULT_SKY_OPTIONS,
      deep: DEFAULT_DEEP_OPTIONS,
      set: (patch) => set(patch),
      setSky: (patch) => set({ sky: { ...get().sky, ...patch } }),
      setDeep: (patch) => set({ deep: { ...get().deep, ...patch } }),
      reducedMotion: () => get().reducedMotionOverride ?? prefersReducedMotion(),
    }),
    {
      name: 'simuverse.settings.v1',
      version: 2,
      storage: safeStorage,
      // v1 (milestone 1) had no location or sky options; defaults fill them in.
      migrate: (persisted) => ({ location: null, sky: DEFAULT_SKY_OPTIONS, deep: DEFAULT_DEEP_OPTIONS, ...(persisted as Partial<Settings>) }) as Settings,
      merge: (persisted, current) => {
        const p = persisted as Partial<Settings>;
        return { ...current, ...p, sky: { ...DEFAULT_SKY_OPTIONS, ...p?.sky }, deep: { ...DEFAULT_DEEP_OPTIONS, ...p?.deep } };
      },
      partialize: (s): Settings => ({
        quality: s.quality,
        adaptiveResolution: s.adaptiveResolution,
        lensFlare: s.lensFlare,
        showLabels: s.showLabels,
        showOrbits: s.showOrbits,
        showPerf: s.showPerf,
        theme: s.theme,
        reducedMotionOverride: s.reducedMotionOverride,
        navOpen: s.navOpen,
        location: s.location,
        sky: s.sky,
        deep: s.deep,
      }),
    },
  ),
);

/** Time zone for displaying times: the observer's if known, else the browser's. */
export function useDisplayTimeZone(): string {
  const tz = useApp((s) => s.location?.tz);
  return tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
