/**
 * Galactic geometry: where the Galactic Centre is, the galactocentric frame
 * the Milky Way model is built in, and the 3D orientation of external galaxies
 * from their sky position angle and axis ratio.
 */

import { EQUATORIAL_TO_ECLIPTIC, EQUATORIAL_TO_GALACTIC, GALACTIC_TO_EQUATORIAL } from './coords.ts';
import { DEG } from './units.ts';
import { type Mat3, type Vec3, mulMat3, mulMat3Vec, normalize, sphericalToCartesian, transpose } from './vec.ts';

/** Sun–Sgr A* distance, pc (GRAVITY Collaboration 2019). */
export const GALACTIC_CENTER_DISTANCE_PC = 8178;
/** Sun's height above the Galactic mid-plane, pc (Bennett & Bovy 2019). */
export const SUN_HEIGHT_PC = 20.8;
/** Sgr A* (Reid & Brunthaler 2004), ICRS degrees. */
export const SGR_A_STAR = { ra: 266.4168371, dec: -29.0078106 };

/** Direction from the Sun to Sgr A*, ICRS unit vector. */
export const galacticCenterDirection = (): Vec3 => sphericalToCartesian(SGR_A_STAR.ra * DEG, SGR_A_STAR.dec * DEG);

/**
 * Galactocentric frame (astropy convention): x from the Sun's projection
 * towards the Galactic Centre, z towards the North Galactic Pole, with the
 * Sun at (−R₀cosθ, 0, z☉). Returns the matrix taking galactocentric vectors
 * to ICRS equatorial, plus the Sun's position in the galactocentric frame (pc).
 */
export function galactocentricFrame(): { toEquatorial: Mat3; sunPc: Vec3 } {
  // Start from galactic axes, then tilt so the plane passes z☉ below the Sun.
  const theta = Math.asin(SUN_HEIGHT_PC / GALACTIC_CENTER_DISTANCE_PC);
  // Galactic (l, b) axes, but with x pointing exactly at Sgr A* (which sits at l ≈ −0.056°, b ≈ −0.046°).
  const gcGal = mulMat3Vec(EQUATORIAL_TO_GALACTIC, galacticCenterDirection());
  const x = normalize(gcGal);
  const zRef: Vec3 = [0, 0, 1];
  // z: galactic north, made orthogonal to x, then tilted by θ about y.
  const dz = x[0] * zRef[0] + x[1] * zRef[1] + x[2] * zRef[2];
  const z0 = normalize([zRef[0] - dz * x[0], zRef[1] - dz * x[1], zRef[2] - dz * x[2]]);
  const y0: Vec3 = [z0[1] * x[2] - z0[2] * x[1], z0[2] * x[0] - z0[0] * x[2], z0[0] * x[1] - z0[1] * x[0]];
  const c = Math.cos(theta), s = Math.sin(theta);
  // Rotating the x/z axes by θ about y moves the mid-plane so the Sun is z☉ above it.
  const xg: Vec3 = [c * x[0] + s * z0[0], c * x[1] + s * z0[1], c * x[2] + s * z0[2]];
  const zg: Vec3 = [-s * x[0] + c * z0[0], -s * x[1] + c * z0[1], -s * x[2] + c * z0[2]];
  // Rows of galactic→galactocentric are the galactocentric axes expressed in galactic coordinates.
  const galToGc: Mat3 = [...xg, ...y0, ...zg] as Mat3;
  const toEquatorial = mulMat3(GALACTIC_TO_EQUATORIAL, transpose(galToGc));
  const R = GALACTIC_CENTER_DISTANCE_PC;
  return { toEquatorial, sunPc: [-R * c, 0, R * s] };
}

/** Galactocentric → ecliptic J2000 (engine world axes). */
export function galactocentricToEcliptic(): Mat3 {
  return mulMat3(EQUATORIAL_TO_ECLIPTIC, galactocentricFrame().toEquatorial);
}

export interface GalaxyBasis {
  /** Unit vectors in the frame of `los` (e.g. ICRS): major axis, in-plane minor axis, disc normal. */
  major: Vec3;
  minor: Vec3;
  normal: Vec3;
  /** Inclination, radians (0 = face-on). */
  inclination: number;
}

/**
 * Orientation of a disc galaxy from its sky position angle (deg, N through E)
 * and apparent axis ratio q, using the Hubble (1926) relation with intrinsic
 * thickness q₀: cos²i = (q² − q₀²)/(1 − q₀²). `los` is the unit vector from the
 * observer to the galaxy. The near/far-side ambiguity is broken by `flip`.
 */
export function galaxyBasis(los: Readonly<Vec3>, paDeg: number, q: number, flip = false, q0 = 0.2): GalaxyBasis {
  const l = normalize([los[0], los[1], los[2]]);
  // Local sky basis at the galaxy: north (towards the celestial pole) and east.
  const pole: Vec3 = Math.abs(l[2]) > 0.9999 ? [1, 0, 0] : [0, 0, 1];
  const east = normalize([pole[1] * l[2] - pole[2] * l[1], pole[2] * l[0] - pole[0] * l[2], pole[0] * l[1] - pole[1] * l[0]]);
  const north: Vec3 = [l[1] * east[2] - l[2] * east[1], l[2] * east[0] - l[0] * east[2], l[0] * east[1] - l[1] * east[0]];
  const pa = paDeg * DEG;
  const major: Vec3 = [
    Math.cos(pa) * north[0] + Math.sin(pa) * east[0],
    Math.cos(pa) * north[1] + Math.sin(pa) * east[1],
    Math.cos(pa) * north[2] + Math.sin(pa) * east[2],
  ];
  const skyMinor: Vec3 = [
    -Math.sin(pa) * north[0] + Math.cos(pa) * east[0],
    -Math.sin(pa) * north[1] + Math.cos(pa) * east[1],
    -Math.sin(pa) * north[2] + Math.cos(pa) * east[2],
  ];
  const qc = Math.min(Math.max(q, q0), 1);
  const cosI = Math.sqrt(Math.max(0, (qc * qc - q0 * q0) / (1 - q0 * q0)));
  const sinI = Math.sqrt(1 - cosI * cosI);
  const sgn = flip ? -1 : 1;
  // Normal tilts from the line of sight towards the sky minor axis.
  const normal: Vec3 = [
    -cosI * l[0] + sgn * sinI * skyMinor[0],
    -cosI * l[1] + sgn * sinI * skyMinor[1],
    -cosI * l[2] + sgn * sinI * skyMinor[2],
  ];
  const minor: Vec3 = [
    normal[1] * major[2] - normal[2] * major[1],
    normal[2] * major[0] - normal[0] * major[2],
    normal[0] * major[1] - normal[1] * major[0],
  ];
  return { major, minor, normal, inclination: Math.acos(cosI) };
}
