import { create } from 'zustand';

/**
 * Service worker registration (production builds only) and its state for the UI:
 * whether the app is ready to work offline, and whether a new version is
 * waiting. A waiting version only takes over when the user reloads into it.
 */
export type OfflineStatus = 'unsupported' | 'installing' | 'ready' | 'failed';

interface OfflineState {
  status: OfflineStatus;
  updateReady: boolean;
  /** Bytes stored by this site (caches and IndexedDB), when the browser reports it. */
  usage: number | null;
  applyUpdate: () => void;
  refreshUsage: () => Promise<void>;
}

let waiting: ServiceWorker | null = null;

export const useOffline = create<OfflineState>()((set) => ({
  status: 'unsupported',
  updateReady: false,
  usage: null,
  applyUpdate: () => {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    waiting.postMessage('skip-waiting');
    // Should the switch-over not be reported (a busy or unusual browser), reload anyway: the new
    // worker is already taking over, so the reloaded page gets the new version either way.
    window.setTimeout(() => location.reload(), 3000);
  },
  refreshUsage: async () => {
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    set({ usage: est?.usage ?? null });
  },
}));

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const set = useOffline.setState;
  set({ status: 'installing' });
  // Only a page that an older version already controls has anything to update. (Checking
  // `controller` later doesn't tell: WebKit sets it on a first visit before 'installed' fires.)
  const hadController = !!navigator.serviceWorker.controller;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      const track = (sw: ServiceWorker | null) => {
        if (!sw) return;
        const check = () => {
          if (sw.state === 'installed' && hadController) {
            // An older version controls this page: offer the new one.
            waiting = sw;
            set({ updateReady: true });
          } else if (sw.state === 'activated') {
            set({ status: 'ready' });
          } else if (sw.state === 'redundant' && !reg.active) {
            set({ status: 'failed' });
          }
        };
        check();
        sw.addEventListener('statechange', check);
      };
      if (reg.active) set({ status: 'ready' });
      track(reg.waiting);
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
    } catch {
      set({ status: 'failed' });
    }
  });
}
