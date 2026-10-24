import { describe, expect, it } from 'vitest';
import {
  EQUATORIAL_TO_ECLIPTIC, EQUATORIAL_TO_GALACTIC, degreesToRadians, earthRotationAngle,
  equatorialToHorizontal, greenwichMeanSiderealTime, hoursToRadians,
} from './coords.ts';
import { jdFromUnixMs } from './time.ts';
import { ARCSEC, DEG } from './units.ts';
import { angleBetween, mulMat3Vec, sphericalToCartesian } from './vec.ts';

describe('sidereal time', () => {
  it('matches Meeus example 12.a (1987-04-10 0h UT → 13h10m46.3668s)', () => {
    const jd = jdFromUnixMs(Date.UTC(1987, 3, 10));
    const gmst = greenwichMeanSiderealTime(jd);
    expect(Math.abs(gmst - hoursToRadians(13, 10, 46.3668))).toBeLessThan(0.01 * 15 * ARCSEC);
  });

  it('ERA at J2000.0 is 280.46°', () => {
    expect(earthRotationAngle(2451545.0) / DEG).toBeCloseTo(280.46061837504, 8);
  });
});

describe('horizontal coordinates', () => {
  it('matches Meeus example 13.b (Venus from Washington, 1987-04-10 19:21 UT)', () => {
    const ra = hoursToRadians(23, 9, 16.641);
    const dec = degreesToRadians(-6, 43, 11.61);
    const lat = degreesToRadians(38, 55, 17);
    const lon = -degreesToRadians(77, 3, 56);
    const apparentSidereal = hoursToRadians(8, 34, 56.853);
    const { alt, az } = equatorialToHorizontal(ra, dec, lat, lon, apparentSidereal);
    expect(alt / DEG).toBeCloseTo(15.1249, 3);
    // Meeus gives 68.0337° measured from south; north-based is +180°.
    expect(az / DEG).toBeCloseTo(248.0337, 3);
  });
});

describe('frame rotations', () => {
  it('maps the ecliptic pole (RA 18h, Dec 66.56°) to ecliptic +Z', () => {
    const pole = sphericalToCartesian(270 * DEG, (90 - 23.4392911) * DEG);
    const v = mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, pole);
    expect(angleBetween(v, [0, 0, 1])).toBeLessThan(1 * ARCSEC);
  });

  it('maps the north galactic pole and galactic centre to their axes', () => {
    const ngp = sphericalToCartesian(192.85948 * DEG, 27.12825 * DEG);
    expect(angleBetween(mulMat3Vec(EQUATORIAL_TO_GALACTIC, ngp), [0, 0, 1])).toBeLessThan(1 * ARCSEC);
    // Galactic centre (l = 0, b = 0): RA 266.40500°, Dec −28.93617°
    const gc = sphericalToCartesian(266.405 * DEG, -28.93617 * DEG);
    expect(angleBetween(mulMat3Vec(EQUATORIAL_TO_GALACTIC, gc), [1, 0, 0])).toBeLessThan(1 * ARCSEC);
  });
});
