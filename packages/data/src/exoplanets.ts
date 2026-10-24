/**
 * Exoplanet systems from the NASA Exoplanet Archive (tools/build-exoplanets.mjs),
 * with stellar parameters completed from each other where the archive lacks them.
 */

import {
  EQUATORIAL_TO_ECLIPTIC, type Vec3, habitableZone, luminosityFromAbsMag, mulMat3Vec, radiusFromLuminosity,
  radiusFromMass, sphericalToCartesian,
} from '@simuverse/astro';

export interface Exoplanet {
  name: string;
  /** Planet letter or suffix after the host name ("b", "e"). */
  letter: string;
  periodDays: number | null;
  aAU: number | null;
  ecc: number | null;
  inclDeg: number | null;
  argPeriDeg: number | null;
  transitMidJd: number | null;
  /** Earth radii: measured, or from the mass–radius relation when only the mass is known. */
  radiusEarth: number;
  radiusMeasured: boolean;
  massEarth: number | null;
  eqTempK: number | null;
  discYear: number | null;
  method: string | null;
  facility: string | null;
}

export interface ExoSystem {
  index: number;
  host: string;
  raDeg: number;
  decDeg: number;
  distPc: number;
  /** Sun → host, parsecs, ecliptic J2000. */
  positionPc: Vec3;
  vmag: number | null;
  spectralType: string | null;
  teff: number;
  /** Solar units; filled in from each other (and from V) where missing. */
  radiusSun: number;
  massSun: number;
  lum: number;
  starCount: number;
  hz: { inner: number; outer: number };
  planets: Exoplanet[];
}

type PlanetRow = [string, number | null, number | null, number | null, number | null, number | null, number | null,
  number | null, number | null, number | null, number | null, string | null, string | null];
type SystemRow = [string, number, number, number, number | null, string | null, number | null, number | null,
  number | null, number | null, number | null, PlanetRow[]];

export function decodeExoplanets(json: { systems: SystemRow[] }): ExoSystem[] {
  const d2r = Math.PI / 180;
  return json.systems.map((s, index) => {
    const [host, ra, dec, distPc, vmag, spect, teffIn, radIn, massIn, logLum, snum, rows] = s;
    const teff = teffIn ?? 5000;
    // Luminosity: archive value, else from radius and Teff, else from V and distance.
    let lum = logLum !== null ? 10 ** logLum : NaN;
    if (!Number.isFinite(lum) && radIn !== null) lum = radIn ** 2 * (teff / 5772) ** 4;
    if (!Number.isFinite(lum) && vmag !== null) lum = luminosityFromAbsMag(vmag - 5 * Math.log10(distPc / 10), teff);
    if (!Number.isFinite(lum)) lum = 1;
    const radiusSun = radIn ?? radiusFromLuminosity(lum, teff);
    const massSun = massIn ?? Math.max(0.08, lum ** 0.25);
    const eq = sphericalToCartesian(ra * d2r, dec * d2r, distPc);
    const planets = rows.map((p): Exoplanet => {
      const [name, period, a, ecc, incl, w, tmid, rad, mass, teq, year, method, facility] = p;
      const letter = name.startsWith(host) ? name.slice(host.length).trim() : name;
      // A few archive masses are impossible for the measured radius (e.g. 12,000 M⊕ at 1.2 R⊕):
      // beyond ~50 × Earth's density (brown dwarfs reach ~20), drop the mass rather than trust it.
      const massOk = mass === null || rad === null || mass / rad ** 3 <= 50;
      return {
        name, letter, periodDays: period, aAU: a, ecc, inclDeg: incl, argPeriDeg: w, transitMidJd: tmid,
        radiusEarth: rad ?? (mass !== null ? radiusFromMass(mass) : 1), radiusMeasured: rad !== null,
        massEarth: massOk ? mass : null, eqTempK: teq, discYear: year, method, facility,
      };
    });
    return {
      index, host, raDeg: ra, decDeg: dec, distPc, positionPc: mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, eq), vmag,
      spectralType: spect, teff, radiusSun, massSun, lum, starCount: snum ?? 1, hz: habitableZone(lum, teff), planets,
    };
  });
}

export async function loadExoplanets(baseUrl: string): Promise<ExoSystem[]> {
  const res = await fetch(new URL('exoplanets.json', new URL(baseUrl, location.href)));
  if (!res.ok) throw new Error(`exoplanets.json: ${res.status}`);
  return decodeExoplanets(await res.json());
}
