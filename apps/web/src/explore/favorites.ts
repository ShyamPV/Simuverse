import { type Favorite, type Visit, listFavorites, listVisits, recordVisit, setFavorite } from '@simuverse/data';
import { useEffect } from 'react';
import { create } from 'zustand';
import { useApp } from '../state/store.ts';

interface ExploreStore {
  favorites: Favorite[];
  visits: Visit[];
  loaded: boolean;
  load: () => Promise<void>;
  toggleFavorite: (ref: string, name: string) => Promise<void>;
  visit: (ref: string, name: string) => Promise<void>;
}

/** Favourites and travel history, persisted in IndexedDB. */
export const useExploreStore = create<ExploreStore>()((set, get) => ({
  favorites: [],
  visits: [],
  loaded: false,
  load: async () => {
    const [favorites, visits] = await Promise.all([listFavorites(), listVisits()]);
    set({ favorites, visits, loaded: true });
  },
  toggleFavorite: async (ref, name) => {
    const on = !get().favorites.some((f) => f.ref === ref);
    // Optimistic: update the UI, then persist.
    set({ favorites: on ? [{ ref, name, addedAt: Date.now() }, ...get().favorites] : get().favorites.filter((f) => f.ref !== ref) });
    await setFavorite(ref, name, on);
  },
  visit: async (ref, name) => {
    await recordVisit(ref, name);
    set({ visits: await listVisits() });
  },
}));

/**
 * Records a visit whenever a warp ends: the object you arrived at goes into
 * the Explore tab's "Visited" list.
 */
export function useVisitTracking(): void {
  useEffect(() => {
    void useExploreStore.getState().load();
    let warping = false;
    return useApp.subscribe((s) => {
      const w = !!s.stats?.warp;
      if (warping && !w && s.engine && s.stats) {
        const id = s.stats.focusId;
        // Scale levels (Milky Way, Laniakea …) are places, not objects.
        if (!['galaxy', 'local-group', 'virgo', 'laniakea', 'universe'].includes(id)) {
          void useExploreStore.getState().visit(s.engine.refFor(id), s.stats.focusName);
        }
      }
      warping = w;
    });
  }, []);
}
