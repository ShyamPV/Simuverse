/**
 * Body orientation from IAU WGCCRE 2015 rotational elements (Archinal et al.
 * 2018), leading terms only; small periodic terms (e.g. Moon libration,
 * Mercury/Mars nutations) are omitted, giving errors up to a few degrees for
 * the Moon and well under a degree elsewhere.
 */

import { EQUATORIAL_TO_ECLIPTIC } from './coords.ts';
import { J2000 } from './time.ts';
import { DEG } from './units.ts';
import { type Mat3, mulMat3, rotX, rotZ, transpose } from './vec.ts';

export interface RotationElements {
  /** Pole right ascension α0 (deg) as a function of T (Julian centuries TDB). */
  ra: (T: number) => number;
  /** Pole declination δ0 (deg). */
  dec: (T: number) => number;
  /** Prime meridian angle W (deg) as a function of d (days TDB from J2000). */
  w: (d: number, T: number) => number;
}

const neptuneN = (T: number) => (357.85 + 52.316 * T) * DEG;

export const ROTATION: Record<string, RotationElements> = {
  sun: { ra: () => 286.13, dec: () => 63.87, w: (d) => 84.176 + 14.1844 * d },
  mercury: {
    ra: (T) => 281.0103 - 0.0328 * T,
    dec: (T) => 61.4155 - 0.0049 * T,
    w: (d) => 329.5988 + 6.1385108 * d,
  },
  venus: { ra: () => 272.76, dec: () => 67.16, w: (d) => 160.2 - 1.4813688 * d },
  earth: { ra: (T) => -0.641 * T, dec: (T) => 90 - 0.557 * T, w: (d) => 190.147 + 360.9856235 * d },
  moon: {
    ra: (T) => 269.9949 + 0.0031 * T,
    dec: (T) => 66.5392 + 0.013 * T,
    w: (d) => 38.3213 + 13.17635815 * d,
  },
  mars: {
    ra: (T) => 317.269202 - 0.10927547 * T,
    dec: (T) => 54.432516 - 0.05827105 * T,
    w: (d) => 176.049863 + 350.891982443297 * d,
  },
  jupiter: {
    ra: (T) => 268.056595 - 0.006499 * T,
    dec: (T) => 64.495303 + 0.002413 * T,
    w: (d) => 284.95 + 870.536 * d,
  },
  saturn: { ra: (T) => 40.589 - 0.036 * T, dec: (T) => 83.537 - 0.004 * T, w: (d) => 38.9 + 810.7939024 * d },
  uranus: { ra: () => 257.311, dec: () => -15.175, w: (d) => 203.81 - 501.1600928 * d },
  neptune: {
    ra: (T) => 299.36 + 0.7 * Math.sin(neptuneN(T)),
    dec: (T) => 43.46 - 0.51 * Math.cos(neptuneN(T)),
    w: (d, T) => 249.978 + 541.1397757 * d - 0.48 * Math.sin(neptuneN(T)),
  },
};

/**
 * Matrix taking body-fixed coordinates (z → north pole, x → prime meridian)
 * to ecliptic J2000. Returns undefined for bodies without elements.
 */
export function bodyToEclipticMatrix(id: string, jdTdb: number): Mat3 | undefined {
  const el = ROTATION[id];
  if (!el) return undefined;
  const d = jdTdb - J2000;
  const T = d / 36525;
  // ICRF → body-fixed: Rz(W) · Rx(90° − δ0) · Rz(90° + α0)
  const icrfToBody = mulMat3(
    rotZ(el.w(d, T) * DEG),
    mulMat3(rotX((90 - el.dec(T)) * DEG), rotZ((90 + el.ra(T)) * DEG)),
  );
  return mulMat3(EQUATORIAL_TO_ECLIPTIC, transpose(icrfToBody));
}
