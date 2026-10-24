/**
 * Observer location. On first run we never prompt: the default is the most
 * populous city in the browser's time zone. If geolocation permission was
 * already granted (e.g. on a previous visit) the precise position is used
 * quietly; otherwise the Sky panel offers a "Use my location" button.
 */

import { type Place, defaultPlaceForTimeZone } from '@simuverse/data';
import { useEffect } from 'react';
import { type SavedLocation, useApp } from './state/store.ts';

const DATA = `${import.meta.env.BASE_URL}data/`;

export function placeToLocation(p: Place, source: SavedLocation['source']): SavedLocation {
  const region = p.admin && p.admin !== p.name ? `${p.admin}, ` : '';
  const country = (() => {
    try {
      return new Intl.DisplayNames(undefined, { type: 'region' }).of(p.country) ?? p.country;
    } catch {
      return p.country;
    }
  })();
  return { name: `${p.name}, ${region}${country}`, latDeg: p.lat, lonDeg: p.lon, elevation: p.elevation, tz: p.tz, source };
}

/** Asks the browser for the device position (may prompt). Resolves null on refusal/failure. */
export function requestDeviceLocation(): Promise<SavedLocation | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          name: 'Your location',
          latDeg: pos.coords.latitude,
          lonDeg: pos.coords.longitude,
          elevation: pos.coords.altitude ?? 0,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          source: 'geolocation',
        }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  });
}

async function geolocationAlreadyGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

/** Ensures a location exists, without ever prompting on page load. */
export function useObserverBootstrap(): void {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { location, set } = useApp.getState();
      if (!location) {
        const place = await defaultPlaceForTimeZone(new URL(DATA, window.location.href).href);
        if (!cancelled && !useApp.getState().location) set({ location: placeToLocation(place, 'timezone') });
      }
      const current = useApp.getState().location;
      if ((!current || current.source !== 'search') && (await geolocationAlreadyGranted())) {
        const precise = await requestDeviceLocation();
        if (precise && !cancelled) set({ location: precise });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
