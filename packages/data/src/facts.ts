/**
 * Curated facts and discovery circumstances for well-known objects, keyed by
 * name (matched through the catalogue's names and aliases, case- and
 * accent-insensitively). Objects without an entry get facts generated from
 * their data instead (see generatedFacts in the web app).
 */

import { normalizeName } from './search.ts';

export interface Fact {
  text: string;
  source: string;
}

export interface CuratedInfo {
  facts: Fact[];
  /** Discovery, where the catalogue has none (year may be negative for BCE, or absent for antiquity). */
  discovered?: { year?: number; by: string };
}

const NASA = 'NASA Science';
const ESA = 'ESA';
const NEA = 'NASA Exoplanet Archive';

type Entry = [names: string[], facts: [string, string][], discovered?: CuratedInfo['discovered']];

const ENTRIES: Entry[] = [
  // ---------------------------------------------------------------- Solar System
  [['Sun'], [
    ['The Sun holds about 99.8% of all the mass in the Solar System.', NASA],
    ['Sunlight takes about 8 minutes 20 seconds to reach Earth.', NASA],
    ['In its core, at about 15 million °C, hydrogen fuses into helium.', NASA],
  ]],
  [['Mercury'], [
    ['Mercury is the smallest planet and the closest to the Sun.', NASA],
    ['One solar day on Mercury (sunrise to sunrise) lasts 176 Earth days: two of its 88-day years.', NASA],
    ['Despite being closest to the Sun, it is not the hottest planet; Venus is.', NASA],
  ], { by: 'Known since antiquity' }],
  [['Venus'], [
    ['A thick carbon-dioxide atmosphere traps heat, keeping the surface near 465 °C, the hottest of any planet.', NASA],
    ['Venus spins backwards, and so slowly that its day (243 Earth days) is longer than its year (225 days).', NASA],
    ['Surface pressure is about 92 times Earth’s.', NASA],
  ], { by: 'Known since antiquity' }],
  [['Earth'], [
    ['Earth is the only world known to host life.', NASA],
    ['About 71% of the surface is covered by water.', NASA],
    ['Its magnetic field shields the surface from much of the solar wind.', NASA],
  ]],
  [['Moon'], [
    ['The Moon is drifting away from Earth by about 3.8 cm a year, measured by bouncing lasers off reflectors left by Apollo.', NASA],
    ['It always shows the same face to Earth because its rotation is tidally locked.', NASA],
    ['Twelve astronauts walked on the Moon during the Apollo programme, between 1969 and 1972.', NASA],
  ], { by: 'Known since antiquity' }],
  [['Mars'], [
    ['Olympus Mons, about 22 km high, is the largest known volcano in the Solar System.', NASA],
    ['Its red colour comes from iron oxide (rust) in its dust.', NASA],
    ['The Valles Marineris canyon system stretches about 4,000 km.', NASA],
  ], { by: 'Known since antiquity' }],
  [['Jupiter'], [
    ['Jupiter is more than twice as massive as all the other planets combined.', NASA],
    ['The Great Red Spot is a storm wider than Earth that has raged for at least 150 years.', NASA],
    ['It has the shortest day of the planets: just under 10 hours.', NASA],
  ], { by: 'Known since antiquity' }],
  [['Saturn'], [
    ['Saturn’s average density is lower than that of water.', NASA],
    ['Its main rings are about 280,000 km across but mostly only about ten metres thick.', NASA],
    ['NASA’s Cassini orbited Saturn from 2004 until it plunged into the planet in 2017.', NASA],
  ], { by: 'Known since antiquity' }],
  [['Uranus'], [
    ['Uranus is tipped on its side, with an axial tilt of about 98°.', NASA],
    ['It was the first planet discovered with a telescope.', NASA],
    ['Voyager 2, in 1986, is the only spacecraft to have visited it.', NASA],
  ], { year: 1781, by: 'William Herschel' }],
  [['Neptune'], [
    ['Neptune was found at the position Urbain Le Verrier had predicted mathematically from Uranus’s motion.', NASA],
    ['Its winds, over 2,000 km/h, are the fastest measured in the Solar System.', NASA],
    ['A year on Neptune lasts about 165 Earth years; it completed its first orbit since discovery in 2011.', NASA],
  ], { year: 1846, by: 'Johann Galle (predicted by Urbain Le Verrier)' }],
  [['Pluto'], [
    ['The IAU reclassified Pluto as a dwarf planet in 2006.', 'IAU'],
    ['New Horizons flew past in July 2015 and revealed a vast heart-shaped plain of nitrogen ice, Sputnik Planitia.', NASA],
    ['Pluto and Charon orbit a point between them, almost a double world.', NASA],
  ], { year: 1930, by: 'Clyde Tombaugh' }],
  [['Phobos'], [
    ['Phobos orbits Mars three times a day and is slowly spiralling inwards.', NASA],
    ['In tens of millions of years it will either crash into Mars or break up into a ring.', NASA],
  ], { year: 1877, by: 'Asaph Hall' }],
  [['Deimos'], [
    ['Deimos is one of the smallest moons in the Solar System, about 12 km across.', NASA],
    ['From the surface of Mars it would look like a bright star.', NASA],
  ], { year: 1877, by: 'Asaph Hall' }],
  [['Io'], [
    ['Io is the most volcanically active world in the Solar System.', NASA],
    ['Tides raised by Jupiter, kept going by orbital resonances with Europa and Ganymede, heat its interior.', NASA],
  ], { year: 1610, by: 'Galileo Galilei' }],
  [['Europa'], [
    ['A global ocean of salty water probably lies beneath Europa’s icy shell.', NASA],
    ['NASA’s Europa Clipper, launched in 2024, is on its way to study it.', NASA],
  ], { year: 1610, by: 'Galileo Galilei' }],
  [['Ganymede'], [
    ['Ganymede is the largest moon in the Solar System, bigger than the planet Mercury.', NASA],
    ['It is the only moon known to generate its own magnetic field.', NASA],
  ], { year: 1610, by: 'Galileo Galilei' }],
  [['Callisto'], [
    ['Callisto’s surface is one of the most heavily cratered in the Solar System.', NASA],
    ['It may hide an ocean deep beneath its crust.', NASA],
  ], { year: 1610, by: 'Galileo Galilei' }],
  [['Titan'], [
    ['Titan is the only moon with a thick atmosphere; surface pressure is about 1.5 times Earth’s.', NASA],
    ['It has lakes and seas of liquid methane and ethane.', NASA],
    ['ESA’s Huygens probe landed on Titan in January 2005.', ESA],
  ], { year: 1655, by: 'Christiaan Huygens' }],
  [['Enceladus'], [
    ['Jets of water vapour and ice spray from Enceladus’s south pole, feeding Saturn’s E ring.', NASA],
    ['It reflects almost all the sunlight that falls on it.', NASA],
  ], { year: 1789, by: 'William Herschel' }],
  [['Mimas'], [
    ['Herschel crater spans about a third of Mimas’s diameter.', NASA],
  ], { year: 1789, by: 'William Herschel' }],
  [['Iapetus'], [
    ['One hemisphere of Iapetus is as dark as coal, the other bright as snow.', NASA],
    ['A ridge runs along much of its equator, rising up to about 20 km.', NASA],
  ], { year: 1671, by: 'Giovanni Domenico Cassini' }],
  [['Rhea'], [['Rhea is Saturn’s second-largest moon.', NASA]], { year: 1672, by: 'Giovanni Domenico Cassini' }],
  [['Tethys'], [['Tethys is made almost entirely of water ice.', NASA]], { year: 1684, by: 'Giovanni Domenico Cassini' }],
  [['Dione'], [['Dione’s bright “wispy terrain” turned out to be ice cliffs hundreds of metres high.', NASA]], { year: 1684, by: 'Giovanni Domenico Cassini' }],
  [['Miranda'], [['Miranda has Verona Rupes, a cliff about 20 km high, possibly the tallest in the Solar System.', NASA]], { year: 1948, by: 'Gerard Kuiper' }],
  [['Ariel'], [['Ariel has the brightest and possibly youngest surface of Uranus’s major moons.', NASA]], { year: 1851, by: 'William Lassell' }],
  [['Umbriel'], [['Umbriel is the darkest of Uranus’s large moons.', NASA]], { year: 1851, by: 'William Lassell' }],
  [['Titania'], [['Titania is the largest moon of Uranus.', NASA]], { year: 1787, by: 'William Herschel' }],
  [['Oberon'], [['Oberon is the outermost of Uranus’s major moons.', NASA]], { year: 1787, by: 'William Herschel' }],
  [['Triton'], [
    ['Triton orbits Neptune backwards, a sign that it was captured from the Kuiper Belt.', NASA],
    ['Voyager 2 saw geysers of nitrogen gas erupting from its surface in 1989.', NASA],
  ], { year: 1846, by: 'William Lassell' }],
  [['Nereid'], [['Nereid has one of the most eccentric orbits of any moon.', NASA]], { year: 1949, by: 'Gerard Kuiper' }],
  [['Charon'], [
    ['Charon is about half the diameter of Pluto.', NASA],
    ['A reddish cap of material escaped from Pluto’s atmosphere colours its north pole.', NASA],
  ], { year: 1978, by: 'James Christy' }],

  // ---------------------------------------------------------------- Small bodies
  [['Ceres'], [
    ['Ceres is the largest object in the asteroid belt and is classed as a dwarf planet.', NASA],
    ['NASA’s Dawn found bright deposits of salts in Occator Crater.', NASA],
    ['It was the first asteroid discovered.', NASA],
  ]],
  [['Vesta'], [
    ['Vesta is the brightest asteroid and can occasionally be seen with the naked eye.', NASA],
    ['Dawn orbited it in 2011–2012; the Rheasilvia impact basin has a central peak about 20 km high.', NASA],
  ]],
  [['Eris'], [
    ['Eris is about the size of Pluto but more massive; its discovery led to Pluto’s reclassification.', NASA],
  ]],
  [['Sedna'], [['Sedna is one of the most distant known objects in the Solar System; one orbit takes about 11,000 years.', NASA]]],
  [['Arrokoth'], [['Arrokoth, visited by New Horizons in 2019, is the most distant object explored by a spacecraft; it is a contact binary.', NASA]]],
  [['Halley’s Comet', '1P/Halley'], [
    ['Halley’s Comet returns every 75–76 years; its next perihelion is in 2061.', NASA],
    ['Edmond Halley predicted its return; ESA’s Giotto photographed its nucleus in 1986.', ESA],
  ]],
  [['Churyumov–Gerasimenko', '67P'], [
    ['ESA’s Rosetta orbited this comet from 2014 to 2016; its lander Philae touched down in November 2014.', ESA],
  ]],
  [['Bennu'], [['NASA’s OSIRIS-REx collected a sample from Bennu and delivered it to Earth in September 2023.', NASA]]],
  [['Ryugu'], [['JAXA’s Hayabusa2 returned samples from Ryugu to Earth in December 2020.', 'JAXA']]],
  [['Itokawa'], [['JAXA’s Hayabusa returned the first asteroid samples, from Itokawa, in 2010.', 'JAXA']]],
  [['Apophis'], [['On 13 April 2029 Apophis will pass about 32,000 km from Earth, closer than geostationary satellites, and be visible to the naked eye.', NASA]]],
  [['Didymos'], [['NASA’s DART spacecraft struck Didymos’s moonlet Dimorphos in September 2022, shortening its orbit by about 32 minutes.', NASA]]],
  [['Eros'], [['NEAR Shoemaker landed on Eros in 2001, the first landing on an asteroid.', NASA]]],
  [['Psyche'], [['Psyche may be the exposed metal core of a shattered planetesimal; NASA’s Psyche mission is due to arrive in 2029.', NASA]]],
  [['Tempel 1'], [['NASA’s Deep Impact fired a projectile into Tempel 1 in 2005 to study its interior.', NASA]]],
  [['Wild 2'], [['NASA’s Stardust returned dust from Wild 2’s coma to Earth in 2006.', NASA]]],
  [['Swift–Tuttle'], [['Swift–Tuttle is the parent of the Perseid meteor shower each August.', NASA]]],
  [['Tempel–Tuttle'], [['Tempel–Tuttle is the parent of the Leonid meteor shower each November.', NASA]]],
  [['Phaethon'], [['Phaethon, an asteroid, is the parent of the Geminid meteor shower.', NASA]]],
  [['Hale–Bopp'], [['Hale–Bopp stayed visible to the naked eye for about 18 months in 1996–1997, a record.', NASA]]],
  [['NEOWISE'], [['Comet NEOWISE was a bright naked-eye comet in July 2020.', NASA]]],
  [['1I/ʻOumuamua', 'Oumuamua'], [['ʻOumuamua was the first object known to have come from another star system.', NASA]]],
  [['2I/Borisov', 'Borisov'], [['2I/Borisov was the first known interstellar comet.', NASA]]],

  // ---------------------------------------------------------------- Stars
  [['Sirius'], [
    ['Sirius is the brightest star in the night sky.', NASA],
    ['Its companion Sirius B is a white dwarf with about the Sun’s mass packed into a ball the size of Earth.', NASA],
  ]],
  [['Canopus'], [['Canopus is the second-brightest star in the night sky; spacecraft have used it as a navigation reference.', NASA]]],
  [['Arcturus'], [['Arcturus is an orange giant and the brightest star in the northern celestial hemisphere.', NASA]]],
  [['Rigil Kentaurus', 'Alpha Centauri', 'Alpha Centauri A'], [
    ['Alpha Centauri is the nearest star system to the Sun, about 4.4 light-years away.', NASA],
    ['Its two Sun-like stars orbit each other every 80 years; the red dwarf Proxima Centauri circles far outside.', NASA],
  ]],
  [['Proxima Centauri'], [
    ['Proxima Centauri is the nearest star to the Sun, about 4.24 light-years away.', NASA],
    ['It is a red dwarf too faint to see without a telescope.', NASA],
    ['Its planet Proxima b orbits in the star’s habitable zone.', NEA],
  ]],
  [['Betelgeuse'], [
    ['Betelgeuse is a red supergiant several hundred times the Sun’s radius.', NASA],
    ['Its “Great Dimming” of 2019–2020 was caused by a cloud of dust it ejected.', NASA],
    ['It is expected to explode as a supernova, probably within the next 100,000 years.', NASA],
  ]],
  [['Rigel'], [['Rigel is a blue supergiant shining with tens of thousands of times the Sun’s luminosity.', NASA]]],
  [['Vega'], [
    ['Vega was the first star other than the Sun to be photographed, in 1850.', 'Harvard College Observatory'],
    ['Precession of Earth’s axis will make Vega the northern pole star again around AD 13,700.', NASA],
  ]],
  [['Polaris'], [
    ['Polaris lies less than a degree from the north celestial pole, so it barely moves in the sky.', NASA],
    ['It is a Cepheid variable, a yellow supergiant that pulsates slightly.', NASA],
  ]],
  [['Antares'], [['Antares is a red supergiant whose name means “rival of Mars”.', NASA]]],
  [['Aldebaran'], [['Aldebaran marks the eye of Taurus; it is not a member of the Hyades cluster it appears among.', NASA]]],
  [['Altair'], [['Altair spins once every 9 hours or so, so fast that it is visibly flattened.', NASA]]],
  [['Deneb'], [['Deneb is one of the most luminous stars visible to the naked eye.', NASA]]],
  [['Barnard’s Star'], [['Barnard’s Star moves across the sky faster than any other star: 10.4 arcseconds a year.', NASA]]],
  [['Fomalhaut'], [['Fomalhaut is surrounded by a broad ring of dusty debris imaged by Hubble and JWST.', NASA]]],
  [['Capella'], [['Capella is a system of four stars: two yellow giants and a pair of red dwarfs.', NASA]]],
  [['Procyon'], [['Like Sirius, Procyon has a white-dwarf companion.', NASA]]],
  [['Spica'], [['Spica is a close pair of hot blue stars orbiting each other every four days.', NASA]]],
  [['Regulus'], [['Regulus spins so fast that it is close to flying apart.', NASA]]],
  [['Mira'], [['Mira is the prototype long-period variable, brightening and fading over about 11 months.', NASA]]],
  [['Algol'], [['Algol, the “Demon Star”, dims every 2.87 days when its fainter companion passes in front.', NASA]]],
  [['Tau Ceti'], [['Tau Ceti is one of the nearest Sun-like stars, about 12 light-years away.', NASA]]],
  [['Epsilon Eridani', 'Ran'], [['Epsilon Eridani is a young, nearby star with a debris disc and at least one giant planet.', NEA]]],

  // ---------------------------------------------------------------- Nebulae and clusters
  [['Great Orion Nebula', 'Orion Nebula', 'M42'], [
    ['The Orion Nebula is the nearest large region of massive star formation, about 1,350 light-years away.', NASA],
    ['It is visible to the naked eye as the middle “star” of Orion’s sword.', NASA],
    ['The young, hot stars of the Trapezium cluster at its heart make it glow.', NASA],
  ], { year: 1610, by: 'Nicolas-Claude Fabri de Peiresc' }],
  [['Crab Nebula', 'M1'], [
    ['The Crab Nebula is the remnant of a supernova that was recorded by Chinese astronomers in 1054.', NASA],
    ['A pulsar at its centre spins about 30 times a second.', NASA],
  ], { year: 1731, by: 'John Bevis' }],
  [['Ring Nebula', 'M57'], [
    ['The Ring Nebula is a planetary nebula: the shed outer layers of a dying Sun-like star.', NASA],
    ['JWST imaged its intricate structure in 2023.', NASA],
  ], { year: 1779, by: 'Antoine Darquier de Pellepoix' }],
  [['Dumbbell Nebula', 'M27'], [['The Dumbbell was the first planetary nebula ever discovered.', NASA]], { year: 1764, by: 'Charles Messier' }],
  [['Helix Nebula'], [['The Helix is one of the closest planetary nebulae, roughly 650 light-years away.', NASA]], { by: 'Karl Ludwig Harding (before 1824)' }],
  [['Cat’s Eye Nebula', 'NGC 6543'], [
    ['In 1864 William Huggins’s spectrum of the Cat’s Eye showed for the first time that some nebulae are glowing gas.', 'Royal Society'],
  ], { year: 1786, by: 'William Herschel' }],
  [['Eagle Nebula', 'M16'], [['The Eagle Nebula holds the “Pillars of Creation”, photographed by Hubble in 1995 and by JWST in 2022.', NASA]], { year: 1745, by: 'Jean-Philippe Loys de Chéseaux' }],
  [['Lagoon Nebula', 'M8'], [['From dark sites the Lagoon Nebula is visible to the naked eye in Sagittarius.', NASA]], { year: 1680, by: 'John Flamsteed (c. 1680)' }],
  [['Trifid Nebula', 'M20'], [['The Trifid combines a red emission nebula, a blue reflection nebula and dark dust lanes.', NASA]], { year: 1764, by: 'Charles Messier' }],
  [['Omega Nebula', 'M17'], [['The Omega Nebula is one of the brightest and most massive star-forming regions in the Milky Way.', NASA]], { year: 1745, by: 'Jean-Philippe Loys de Chéseaux' }],
  [['Carina Nebula'], [
    ['The Carina Nebula is about four times the size of the Orion Nebula.', NASA],
    ['It contains Eta Carinae, one of the most massive and luminous stars known.', NASA],
  ], { year: 1752, by: 'Nicolas-Louis de Lacaille' }],
  [['Rosette Nebula', 'Rosette A'], [['Winds from the young cluster NGC 2244 have cleared the hole at the Rosette’s centre.', NASA]]],
  [['North America Nebula'], [['The dark dust cloud that forms its “Gulf of Mexico” gives the nebula its continental outline.', NASA]], { year: 1786, by: 'William Herschel' }],
  [['Horsehead Nebula'], [['The Horsehead is a cloud of dark dust silhouetted against the glowing gas of IC 434.', NASA]], { year: 1888, by: 'Williamina Fleming' }],
  [['Veil Nebula'], [['The Veil is the remnant of a supernova that exploded roughly 10,000–20,000 years ago.', NASA]], { year: 1784, by: 'William Herschel' }],
  [['30 Dor Cluster', 'Tarantula Nebula'], [['The Tarantula Nebula, in the Large Magellanic Cloud, is the most active star-forming region in the Local Group.', ESA]], { year: 1751, by: 'Nicolas-Louis de Lacaille' }],
  [['Pleiades', 'M45'], [
    ['The Pleiades, or Seven Sisters, are young stars about 100 million years old.', NASA],
    ['Their blue haze is starlight scattered by a dust cloud the cluster is passing through.', NASA],
  ], { by: 'Known since antiquity' }],
  [['Beehive Cluster', 'Praesepe', 'M44'], [['Galileo was the first to see the Beehive as individual stars, in 1609–1610.', NASA]], { by: 'Known since antiquity' }],
  [['Hyades'], [['The Hyades is the nearest open cluster to the Sun, about 150 light-years away.', ESA]], { by: 'Known since antiquity' }],
  [['Omega Centauri', 'NGC 5139'], [
    ['Omega Centauri is the largest globular cluster in the Milky Way, with around 10 million stars.', ESA],
    ['It may be the core of a dwarf galaxy swallowed by the Milky Way.', ESA],
  ], { by: 'Ptolemy (as a star)' }],
  [['47 Tuc', '47 Tucanae', 'NGC 104'], [['47 Tucanae is the second-brightest globular cluster, easily visible to the naked eye beside the Small Magellanic Cloud.', ESA]], { year: 1751, by: 'Nicolas-Louis de Lacaille' }],
  [['Great Hercules Cluster', 'Hercules Cluster', 'M13'], [['In 1974 the Arecibo radio telescope beamed a message towards M13.', 'Cornell University']], { year: 1714, by: 'Edmond Halley' }],

  // ---------------------------------------------------------------- Galaxies
  [['Andromeda Galaxy', 'M31'], [
    ['Andromeda is the nearest large galaxy, about 2.5 million light-years away, and easily visible to the naked eye.', NASA],
    ['It is approaching the Milky Way at about 110 km/s; the two may merge in several billion years.', NASA],
  ], { year: 964, by: 'Abd al-Rahman al-Sufi (first recorded)' }],
  [['Triangulum Galaxy', 'M33'], [['Triangulum is the third-largest galaxy in the Local Group.', NASA]], { year: 1764, by: 'Charles Messier' }],
  [['Large Magellanic Cloud'], [['The Large Magellanic Cloud is a satellite galaxy of the Milky Way, about 160,000 light-years away; it hosted Supernova 1987A.', ESA]], { by: 'Known since antiquity in the southern hemisphere' }],
  [['Small Magellanic Cloud'], [['The Small Magellanic Cloud, about 200,000 light-years away, is easily seen with the naked eye from the southern hemisphere.', ESA]], { by: 'Known since antiquity in the southern hemisphere' }],
  [['M87', 'Virgo A'], [
    ['M87 is a giant elliptical galaxy at the heart of the Virgo Cluster.', NASA],
    ['A jet of particles moving close to the speed of light streams about 5,000 light-years from its central black hole.', NASA],
  ], { year: 1781, by: 'Charles Messier' }],
  [['Whirlpool Galaxy', 'M51'], [['The Whirlpool was the first galaxy in which spiral structure was seen, by Lord Rosse in 1845.', NASA]], { year: 1773, by: 'Charles Messier' }],
  [['Sombrero Galaxy', 'M104'], [['A prominent dust lane and a bright central bulge give the Sombrero its hat-like look.', NASA]], { year: 1781, by: 'Pierre Méchain' }],
  [['Cigar Galaxy', 'M82'], [['M82 is a starburst galaxy, forming stars far faster than the Milky Way.', NASA]], { year: 1774, by: 'Johann Elert Bode' }],
  [['Bode’s Galaxy', 'M81'], [['M81’s gravity is pulling gas out of its neighbour M82, triggering M82’s starburst.', NASA]], { year: 1774, by: 'Johann Elert Bode' }],
  [['Pinwheel Galaxy', 'M101'], [['The Pinwheel is a face-on spiral nearly twice the diameter of the Milky Way.', NASA]], { year: 1781, by: 'Pierre Méchain' }],
  [['Centaurus A', 'NGC 5128'], [['Centaurus A is the nearest radio galaxy, shaped by a merger with a smaller galaxy.', ESA]], { year: 1826, by: 'James Dunlop' }],

  // ---------------------------------------------------------------- Exoplanet systems
  [['TRAPPIST-1'], [
    ['Seven Earth-sized planets orbit this ultracool red dwarf; several lie in its habitable zone.', NASA],
    ['All seven orbits would fit inside Mercury’s.', NASA],
  ]],
  [['Proxima Cen', 'Proxima Cen b'], [['Proxima b is the nearest known exoplanet, in its star’s habitable zone.', NEA]]],
  [['51 Peg', '51 Peg b'], [['51 Pegasi b was the first planet found orbiting a Sun-like star (1995), earning Michel Mayor and Didier Queloz the 2019 Nobel Prize.', 'Nobel Prize']]],
  [['Kepler-452 b'], [['Kepler-452 b orbits a Sun-like star in its habitable zone with a 385-day year.', NASA]]],
  [['KELT-9 b'], [['KELT-9 b is one of the hottest planets known, with a dayside around 4,300 °C.', NASA]]],
  [['HD 209458 b'], [['HD 209458 b was the first exoplanet seen to transit its star (1999) and the first with a detected atmosphere.', NASA]]],
  [['55 Cnc e'], [['55 Cancri e is a super-Earth so close to its star that its surface may be molten.', NASA]]],
  [['Kepler-16 b'], [['Kepler-16 b orbits two stars at once, like the fictional Tatooine.', NASA]]],
  [['PSR B1257+12'], [['The first confirmed exoplanets were found in 1992 around this pulsar.', NEA]]],
  [['HR 8799'], [['HR 8799 was the first system with several planets imaged directly.', NEA]]],
  [['beta Pic', 'Beta Pictoris'], [['Beta Pictoris has a dusty debris disc and two giant planets imaged directly.', ESA]]],

  // ---------------------------------------------------------------- Black holes, neutron stars, remnants
  [['Sagittarius A*'], [
    ['Sagittarius A* has about 4 million times the Sun’s mass; stars orbiting it revealed its mass (Nobel Prize 2020).', 'Nobel Prize'],
    ['The Event Horizon Telescope published its image in 2022.', 'Event Horizon Telescope'],
  ]],
  [['M87*'], [
    ['M87* was the first black hole ever imaged, in 2019.', 'Event Horizon Telescope'],
    ['It has about 6.5 billion times the Sun’s mass.', 'Event Horizon Telescope'],
  ]],
  [['Cygnus X-1'], [
    ['Cygnus X-1 was one of the first objects widely accepted as a black hole.', NASA],
    ['Stephen Hawking bet Kip Thorne in 1974 that it was not a black hole, and later conceded.', 'Caltech'],
  ]],
  [['Gaia BH1'], [['Gaia BH1, about 1,560 light-years away, is the nearest known black hole; it was found from its companion star’s wobble.', ESA]]],
  [['Gaia BH3'], [['At about 33 solar masses, Gaia BH3 is the most massive stellar black hole known in the Milky Way.', ESA]]],
  [['Crab Pulsar'], [['The Crab Pulsar spins about 30 times a second and powers the glow of the Crab Nebula.', NASA]]],
  [['Vela Pulsar'], [['The Vela Pulsar spins 11 times a second and is famous for sudden spin-ups called glitches.', NASA]]],
  [['PSR B1919+21'], [
    ['This was the first pulsar discovered; its regular pulses were jokingly nicknamed LGM-1, “Little Green Men”.', 'Nature'],
    ['Its stacked pulse profiles became the cover of Joy Division’s album Unknown Pleasures.', 'Scientific American'],
  ]],
  [['Hulse–Taylor binary pulsar'], [['Its orbit shrinks exactly as general relativity predicts for gravitational-wave emission (Nobel Prize 1993).', 'Nobel Prize']]],
  [['PSR J1748-2446ad'], [['The fastest-spinning pulsar known turns 716 times a second.', 'Science']]],
  [['SGR 1806-20'], [['Its giant flare in December 2004 was the brightest burst ever seen from beyond the Solar System, and it disturbed Earth’s ionosphere.', NASA]]],
  [['Cassiopeia A'], [
    ['Light from the explosion reached Earth around 1680, apparently unnoticed.', NASA],
    ['Cas A is the brightest radio source in the sky beyond the Solar System.', NASA],
  ]],
  [['Tycho’s Supernova Remnant'], [['Tycho Brahe’s careful observations of the 1572 supernova showed that the heavens could change.', NASA]]],
  [['Kepler’s Supernova Remnant'], [['The 1604 supernova studied by Johannes Kepler is the most recent seen with the naked eye in the Milky Way.', NASA]]],
  [['SN 1006'], [['SN 1006 was the brightest stellar event in recorded history, visible even in daylight.', NASA]]],
  [['SN 1987A'], [['SN 1987A was the nearest supernova seen since 1604; neutrinos from it were detected on Earth.', NASA]]],
];

const BY_NAME = new Map<string, CuratedInfo>();
for (const [names, facts, discovered] of ENTRIES) {
  const info: CuratedInfo = { facts: facts.map(([text, source]) => ({ text, source })), discovered };
  for (const n of names) BY_NAME.set(normalizeName(n), info);
}

/** Curated facts for an object, looked up by any of its names. */
export function curatedInfo(names: readonly string[]): CuratedInfo | undefined {
  for (const n of names) {
    const hit = BY_NAME.get(normalizeName(n));
    if (hit) return hit;
  }
  return undefined;
}

export const CURATED_COUNT = ENTRIES.length;
