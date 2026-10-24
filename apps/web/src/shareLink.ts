import type { Engine } from '@simuverse/engine';
import { encodeShare } from './share.ts';
import type { SavedLocation } from './state/store.ts';

/** The current view as a shareable hash. */
export function currentShareHash(engine: Engine, location: SavedLocation | null): string {
  return encodeShare(
    engine.getViewState(),
    location ? { latDeg: location.latDeg, lonDeg: location.lonDeg, name: location.name, tz: location.tz } : undefined,
  );
}

/** Copies a link to the current view; resolves to the URL (also written to the address bar). */
export async function copyShareLink(engine: Engine, location: SavedLocation | null): Promise<string> {
  const url = new URL(window.location.href);
  url.hash = currentShareHash(engine, location);
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url.href);
  } catch {
    // Clipboard access can be refused (permissions, insecure context); the address bar still has the link.
  }
  return url.href;
}
