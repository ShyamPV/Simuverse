/**
 * Black holes, neutron stars and supernova remnants that aren't in the
 * deep-sky catalogue: positions (ICRS), distances and key parameters from the
 * literature (source per entry). `approx` marks distances uncertain by more
 * than ~20%.
 */

export type ExoticKind = 'black-hole' | 'neutron-star' | 'snr';

export interface ExoticObject {
  id: string;
  name: string;
  aliases: string[];
  kind: ExoticKind;
  subtype: string;
  raDeg: number;
  decDeg: number;
  distPc: number;
  approx?: boolean;
  massSun?: number;
  /** Spin period of a pulsar, milliseconds. */
  periodMs?: number;
  /** Apparent size (supernova remnants), arcmin. */
  sizeArcmin?: number;
  discovered?: { year: number; by: string };
  source: string;
}

export const EXOTICA: readonly ExoticObject[] = [
  // Black holes
  {
    id: 'sgr-a-star', name: 'Sagittarius A*', aliases: ['Sgr A*', 'Milky Way black hole'], kind: 'black-hole',
    subtype: 'Supermassive black hole', raDeg: 266.41683, decDeg: -29.00783, distPc: 8178, massSun: 4.3e6,
    discovered: { year: 1974, by: 'Bruce Balick and Robert Brown' }, source: 'GRAVITY Collaboration 2019; EHT 2022',
  },
  {
    id: 'm87-star', name: 'M87*', aliases: ['Pōwehi', 'M87 black hole'], kind: 'black-hole',
    subtype: 'Supermassive black hole', raDeg: 187.70592, decDeg: 12.39111, distPc: 16.8e6, massSun: 6.5e9,
    discovered: { year: 2019, by: 'Event Horizon Telescope (first image)' }, source: 'Event Horizon Telescope Collaboration 2019',
  },
  {
    id: 'cyg-x-1', name: 'Cygnus X-1', aliases: ['Cyg X-1', 'HDE 226868'], kind: 'black-hole', subtype: 'Stellar black hole',
    raDeg: 299.59033, decDeg: 35.20161, distPc: 2220, massSun: 21.2,
    discovered: { year: 1964, by: 'Bowyer et al. (rocket X-ray survey)' }, source: 'Miller-Jones et al. 2021',
  },
  {
    id: 'v404-cyg', name: 'V404 Cygni', aliases: ['GS 2023+338'], kind: 'black-hole', subtype: 'Stellar black hole',
    raDeg: 306.01592, decDeg: 33.86719, distPc: 2390, massSun: 9,
    discovered: { year: 1989, by: 'Ginga satellite (X-ray outburst)' }, source: 'Miller-Jones et al. 2009',
  },
  {
    id: 'gaia-bh1', name: 'Gaia BH1', aliases: ['Gaia DR3 4373465352415301632'], kind: 'black-hole', subtype: 'Dormant stellar black hole',
    raDeg: 262.17121, decDeg: -0.58108, distPc: 480, massSun: 9.6,
    discovered: { year: 2022, by: 'El-Badry et al. (Gaia astrometry)' }, source: 'El-Badry et al. 2023',
  },
  {
    id: 'gaia-bh3', name: 'Gaia BH3', aliases: ['Gaia DR4 4318465066420528000'], kind: 'black-hole', subtype: 'Dormant stellar black hole',
    raDeg: 294.82796, decDeg: 14.93167, distPc: 590, massSun: 32.7,
    discovered: { year: 2024, by: 'Gaia Collaboration' }, source: 'Gaia Collaboration, Panuzzo et al. 2024',
  },
  {
    id: 'a0620-00', name: 'A0620-00', aliases: ['V616 Monocerotis', 'V616 Mon'], kind: 'black-hole', subtype: 'Stellar black hole',
    raDeg: 95.68542, decDeg: -0.34575, distPc: 1060, approx: true, massSun: 6.6,
    discovered: { year: 1975, by: 'Ariel V satellite' }, source: 'Cantrell et al. 2010',
  },
  // Neutron stars
  {
    id: 'crab-pulsar', name: 'Crab Pulsar', aliases: ['PSR B0531+21', 'PSR J0534+2200'], kind: 'neutron-star', subtype: 'Pulsar',
    raDeg: 83.63308, decDeg: 22.0145, distPc: 2000, approx: true, massSun: 1.4, periodMs: 33.6,
    discovered: { year: 1968, by: 'David Staelin and Edward Reifenstein' }, source: 'ATNF Pulsar Catalogue',
  },
  {
    id: 'vela-pulsar', name: 'Vela Pulsar', aliases: ['PSR B0833-45', 'PSR J0835-4510'], kind: 'neutron-star', subtype: 'Pulsar',
    raDeg: 128.83588, decDeg: -45.17636, distPc: 287, periodMs: 89.3,
    discovered: { year: 1968, by: 'Large, Vaughan and Mills' }, source: 'Dodson et al. 2003; ATNF',
  },
  {
    id: 'psr-b1919', name: 'PSR B1919+21', aliases: ['CP 1919', 'PSR J1921+2153', 'first pulsar'], kind: 'neutron-star', subtype: 'Pulsar',
    raDeg: 290.43671, decDeg: 21.88394, distPc: 300, approx: true, periodMs: 1337.3,
    discovered: { year: 1967, by: 'Jocelyn Bell Burnell and Antony Hewish' }, source: 'Hewish et al. 1968; ATNF',
  },
  {
    id: 'psr-b1913', name: 'Hulse–Taylor binary pulsar', aliases: ['PSR B1913+16', 'PSR J1915+1606'], kind: 'neutron-star', subtype: 'Binary pulsar',
    raDeg: 288.86663, decDeg: 16.10761, distPc: 6400, approx: true, massSun: 1.44, periodMs: 59.03,
    discovered: { year: 1974, by: 'Russell Hulse and Joseph Taylor' }, source: 'Weisberg & Huang 2016',
  },
  {
    id: 'psr-j0437', name: 'PSR J0437-4715', aliases: ['nearest millisecond pulsar'], kind: 'neutron-star', subtype: 'Millisecond pulsar',
    raDeg: 69.31625, decDeg: -47.25253, distPc: 156.8, massSun: 1.42, periodMs: 5.757,
    discovered: { year: 1993, by: 'Johnston et al. (Parkes)' }, source: 'Reardon et al. 2016',
  },
  {
    id: 'psr-j1748', name: 'PSR J1748-2446ad', aliases: ['fastest-spinning pulsar'], kind: 'neutron-star', subtype: 'Millisecond pulsar',
    raDeg: 267.02, decDeg: -24.779, distPc: 5900, approx: true, periodMs: 1.396,
    discovered: { year: 2004, by: 'Hessels et al. (Green Bank Telescope)' }, source: 'Hessels et al. 2006',
  },
  {
    id: 'geminga', name: 'Geminga', aliases: ['PSR J0633+1746'], kind: 'neutron-star', subtype: 'Radio-quiet pulsar',
    raDeg: 98.47563, decDeg: 17.77025, distPc: 250, approx: true, periodMs: 237.1,
    discovered: { year: 1972, by: 'SAS-2 satellite (gamma rays)' }, source: 'Faherty et al. 2007',
  },
  {
    id: 'sgr-1806', name: 'SGR 1806-20', aliases: ['magnetar'], kind: 'neutron-star', subtype: 'Magnetar',
    raDeg: 272.16392, decDeg: -20.41106, distPc: 8700, approx: true, periodMs: 7600,
    discovered: { year: 1979, by: 'Soft gamma repeater bursts' }, source: 'Bibby et al. 2008',
  },
  {
    id: 'rxj1856', name: 'RX J1856.5-3754', aliases: ['nearest isolated neutron star'], kind: 'neutron-star', subtype: 'Isolated neutron star',
    raDeg: 284.14625, decDeg: -37.91, distPc: 123, approx: true,
    discovered: { year: 1992, by: 'ROSAT X-ray survey' }, source: 'Walter et al. 2010',
  },
  // Supernova remnants (not in the deep-sky catalogue)
  {
    id: 'cas-a', name: 'Cassiopeia A', aliases: ['Cas A', '3C 461'], kind: 'snr', subtype: 'Supernova remnant',
    raDeg: 350.85, decDeg: 58.815, distPc: 3400, sizeArcmin: 5,
    discovered: { year: 1947, by: 'Martin Ryle and Graham Smith (radio)' }, source: 'Reed et al. 1995',
  },
  {
    id: 'tycho-snr', name: 'Tycho’s Supernova Remnant', aliases: ['SN 1572', '3C 10'], kind: 'snr', subtype: 'Supernova remnant',
    raDeg: 6.325, decDeg: 64.15, distPc: 2500, approx: true, sizeArcmin: 8,
    discovered: { year: 1572, by: 'Tycho Brahe (the supernova)' }, source: 'Krause et al. 2008',
  },
  {
    id: 'kepler-snr', name: 'Kepler’s Supernova Remnant', aliases: ['SN 1604', '3C 358'], kind: 'snr', subtype: 'Supernova remnant',
    raDeg: 262.675, decDeg: -21.483, distPc: 5000, approx: true, sizeArcmin: 3,
    discovered: { year: 1604, by: 'Johannes Kepler (the supernova)' }, source: 'Sankrit et al. 2016',
  },
  {
    id: 'sn-1006', name: 'SN 1006', aliases: ['SN 1006 remnant'], kind: 'snr', subtype: 'Supernova remnant',
    raDeg: 225.7, decDeg: -41.933, distPc: 2200, sizeArcmin: 30,
    discovered: { year: 1006, by: 'Observers in China, Egypt, Iraq, Japan, Switzerland' }, source: 'Winkler et al. 2003',
  },
  {
    id: 'vela-snr', name: 'Vela Supernova Remnant', aliases: ['Vela SNR'], kind: 'snr', subtype: 'Supernova remnant',
    raDeg: 128.5, decDeg: -45.833, distPc: 287, sizeArcmin: 480,
    discovered: { year: 1956, by: 'Bernard Mills (radio)' }, source: 'Dodson et al. 2003',
  },
  {
    id: 'sn-1987a', name: 'SN 1987A', aliases: ['Supernova 1987A'], kind: 'snr', subtype: 'Supernova remnant (in the LMC)',
    raDeg: 83.86679, decDeg: -69.26994, distPc: 51400, sizeArcmin: 0.03,
    discovered: { year: 1987, by: 'Ian Shelton and Oscar Duhalde' }, source: 'Panagia 1999',
  },
];
