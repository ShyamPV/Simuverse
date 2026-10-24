/** Physical data for solar-system bodies (IAU/NASA fact sheets, mean values). */

export type BodyKind = 'star' | 'planet' | 'moon' | 'dwarf-planet';

export interface BodyInfo {
  id: string;
  name: string;
  kind: BodyKind;
  /** Parent body id (orbit centre); undefined for the Sun. */
  parent?: string;
  /** Equatorial radius, metres. */
  radius: number;
  /** Polar radius, metres (oblateness). */
  polarRadius: number;
  /** Mass, kg. */
  mass: number;
  /** Representative colour for markers and untextured rendering (sRGB hex). */
  color: string;
  /** Ring inner/outer radius in metres, if the body has a prominent ring system. */
  rings?: { inner: number; outer: number };
}

export const SOLAR_SYSTEM: readonly BodyInfo[] = [
  { id: 'sun', name: 'Sun', kind: 'star', radius: 695_700e3, polarRadius: 695_700e3, mass: 1.98847e30, color: '#fff4e0' },
  { id: 'mercury', name: 'Mercury', kind: 'planet', parent: 'sun', radius: 2_440.53e3, polarRadius: 2_438.26e3, mass: 3.3011e23, color: '#a8a39c' },
  { id: 'venus', name: 'Venus', kind: 'planet', parent: 'sun', radius: 6_051.8e3, polarRadius: 6_051.8e3, mass: 4.8675e24, color: '#e8d3a2' },
  { id: 'earth', name: 'Earth', kind: 'planet', parent: 'sun', radius: 6_378.137e3, polarRadius: 6_356.752e3, mass: 5.97217e24, color: '#4f86c6' },
  { id: 'moon', name: 'Moon', kind: 'moon', parent: 'earth', radius: 1_738.1e3, polarRadius: 1_736.0e3, mass: 7.342e22, color: '#bdbab4' },
  { id: 'mars', name: 'Mars', kind: 'planet', parent: 'sun', radius: 3_396.19e3, polarRadius: 3_376.2e3, mass: 6.4171e23, color: '#c1440e' },
  { id: 'jupiter', name: 'Jupiter', kind: 'planet', parent: 'sun', radius: 71_492e3, polarRadius: 66_854e3, mass: 1.89819e27, color: '#d8b48a' },
  {
    id: 'saturn', name: 'Saturn', kind: 'planet', parent: 'sun', radius: 60_268e3, polarRadius: 54_364e3, mass: 5.6834e26, color: '#e3cf9a',
    rings: { inner: 74_658e3, outer: 140_220e3 },
  },
  { id: 'uranus', name: 'Uranus', kind: 'planet', parent: 'sun', radius: 25_559e3, polarRadius: 24_973e3, mass: 8.681e25, color: '#a6d8e0' },
  { id: 'neptune', name: 'Neptune', kind: 'planet', parent: 'sun', radius: 24_764e3, polarRadius: 24_341e3, mass: 1.02409e26, color: '#4b70dd' },
  { id: 'pluto', name: 'Pluto', kind: 'dwarf-planet', parent: 'sun', radius: 1_188.3e3, polarRadius: 1_188.3e3, mass: 1.303e22, color: '#d9c4a8' },
];

export const bodyById = (id: string): BodyInfo | undefined => SOLAR_SYSTEM.find((b) => b.id === id);
