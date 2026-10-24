# Simuverse

A realistic, explorable 3D universe in the browser, from your own sky out to the cosmic web.

> **Status: milestone 5 of 6.** The app opens on the real sky over your location: DE440 ephemerides, apparent positions to about an arcsecond, an atmosphere and horizon, constellations, satellites, and rise/set times. Zoom out through the solar system, 2.4 million Gaia/Tycho stars, nebulae, the Milky Way, the Local Group and the cosmic web. Or search for anything (**Ctrl/⌘ K**) and warp there: planets and 21 major moons, any catalogue star, 4,800 exoplanet systems, nebulae, clusters and galaxies. You can also fly freely, and share a link to exactly what you see. The **Explore** tab is a catalogue of about 23,000 objects, including comets, asteroids, black holes and pulsars, with facts and "where to find it" for tonight. See [Roadmap](#roadmap).

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # browser tests (Playwright; builds and serves the app, software GL)
SIMUVERSE_E2E_GPU=1 pnpm test:e2e   # the same on the machine's GPU (much faster)
pnpm build        # static build in apps/web/dist; host anywhere
```

Requires Node 20+ and pnpm 10, plus a browser with WebGL 2.

Generated data is committed, so a fresh clone runs without downloading anything. To regenerate it:

```bash
pnpm data:stars      # HYG v4.1 → stars-hyg.bin (+ names)
pnpm data:ephemeris  # JPL Horizons (DE440) samples → Chebyshev chunks, 1900–2100 (~170 MB download, cached in .cache/)
pnpm data:sky        # constellations (d3-celestial), cities (GeoNames), TLE snapshot (CelesTrak)
pnpm data:textures   # Solar System Scope 2K planet textures
pnpm data:fixtures   # JPL Horizons reference values for the astro tests
pnpm data:stars-octree  # AT-HYG v4.0 (2.4 M stars, ~200 MB download) → data/stars/ octree tiles
pnpm data:galaxies      # 2MRS + Cosmicflows-4 + McConnachie + OpenNGC (VizieR) → galaxies.bin
pnpm data:deepsky       # OpenNGC nebulae and clusters, Harris and Cantat-Gaudin distances → deepsky.json
pnpm data:milkyway      # NASA SVS Deep Star Maps 2020 (8K EXR, ~140 MB) → 4K Milky Way panorama
pnpm data:moons         # JPL Horizons vectors (1950–2050) → fitted mean elements for 21 moons (packages/astro)
pnpm data:exoplanets    # NASA Exoplanet Archive (pscomppars) → exoplanets.json
pnpm data:smallbodies   # JPL Small-Body Database → smallbodies.json (dwarf planets, asteroids, comets, interstellar objects)
pnpm data:images        # CDS hips2fits survey cutouts → data/images/ (nebula, cluster and galaxy images)
```

## Controls

| Input | Sky view | Universe view |
|---|---|---|
| Drag / arrow keys | Look around | Orbit the focused body |
| Scroll / `+` `−` | Zoom (100° down to 1.2′); keep zooming out to lift off | Zoom (logarithmic) |
| Click / double-click | Select / centre a star, planet or satellite | Select; click a body to travel to it |
| `0`–`9` | Select and turn to Sun, Mercury…Neptune, Moon | Travel to them |
| `K` `B` `G` `A` | Constellation lines, boundaries, ground, atmosphere | |
| `Space`, `[` `]`, `N` | Pause, slower/reverse, faster, jump to now | |
| Breadcrumbs / left panel | | Jump to any scale: Milky Way, Local Group, Virgo, Laniakea, Observable Universe |
| `Ctrl`/`⌘` `K` or `/` | Search; `Enter` shows it in the sky, `Shift`+`Enter` goes there | Search; `Enter` goes there, `Shift`+`Enter` shows it in your sky |
| `R` | Surprise me: warp somewhere interesting | |
| `F` | | Free flight on/off: `W` `A` `S` `D` move, `Q` `E` down/up, `Shift` boost, drag to look, scroll sets speed |
| Link button / address bar | The URL always describes the current view; the link button copies it | |
| Explore (left panel) | Catalogue: lists, search, facts, "Go there", "Show in my sky", favourites | |
| `L` `O` `I` `P` `C` `Esc` `?` | Labels, orbits, info panel, perf overlay, screenshot, clear selection, help | |

## Layout

```
apps/web          React UI (Vite, Tailwind v4, Zustand)
packages/astro    Pure, tested astronomy: time scales, frames, DE440 Chebyshev evaluation, Earth
                  orientation, apparent places, rise/set, magnitudes, SGP4 wrapper, fitted moon orbits,
                  stellar physics, exoplanet orbits and habitable zones
packages/engine   Three.js renderer: frame graph, camera rigs (sky, orbit with warp, free flight), layers,
                  shaders, star systems, search and view state, sky-events worker
packages/data     Loaders: star catalogue and octree tiles, galaxies, deep-sky objects, procedural cosmic web
                  (tile workers), exoplanets, small bodies, black holes and pulsars, object images, catalogue facts,
                  name search, ephemeris chunks, constellations, places, TLEs (Dexie cache, favourites, visits)
tools/            Node scripts that build the data files from their public sources
```

## Explore (milestone 5)

- **The catalogue.** One list of about 23,000 entries: the Sun, planets, moons and 38 small bodies; 3,400 named stars; 6,400 exoplanets and their hosts; nebulae, clusters and supernova remnants; named galaxies; and 16 black holes and neutron stars. It is searchable with the same index as the command palette, filterable by category, sortable by notability, name, distance, brightness or size, and drawn as a virtualised list.
- **Each entry** shows an image, type, distance (with light-travel time), size, mass or luminosity, temperature, discovery, constellation and **where to find it**:
  - RA/Dec and where it is in your sky right now;
  - when it is highest tonight (searched across the astronomical night at your location);
  - the best season, and whether you need eyes, binoculars, or a small or large telescope (from magnitude, a magnitude stricter for extended objects);
  - today's rise, transit and set.
- **Facts.** About 140 well-known objects have curated facts, each with its source. The rest get 2–5 facts generated from their catalogue values (light-travel time, size compared with the Solar System, what the light left during, and so on).
- **Lists.** Highlights with a featured object of the day, Visible tonight, Closest of each kind, Most extreme (record holders), Favourites and Visited. Favourites and travel history are kept in IndexedDB. **Go there** warps to the object; **Show in my sky** turns Sky view to it; links open the same object for anyone.
- **Small bodies.** Ceres, Pluto's neighbours (Eris, Haumea, Makemake, Sedna …), notable asteroids, periodic and great comets, and 1I/ʻOumuamua and 2I/Borisov use JPL Small-Body Database elements, propagated as elliptic or hyperbolic two-body orbits. Brightness comes from the H–G system for asteroids and total magnitude M1/K1 for comets. They are labelled, selectable, and visitable in both views.
- **Black holes and neutron stars** (Sgr A*, M87*, Cygnus X-1, Gaia BH1/BH3, the Crab and Vela pulsars, magnetars …) are placed at their measured distances. Each shows its Schwarzschild radius or spin period with the measurement's source.
- **Nebulae look like themselves.** 439 nebulae, clusters and galaxies use their own survey images, not one generic texture:
  - The images come from cutouts from Pan-STARRS1, VPHAS+ (with H-alpha) and DECaPS2, and, for nebulae larger than 25′, the SHASSA and VTSS H-alpha surveys.
  - A build script removes the stars (the catalogue draws those), satellite streaks and saturation bleeds, and sets the black level from the edge of each field.
  - The images are drawn on the sky at the correct orientation and scale, and as billboards in 3D.
  - Up close, nebulae with a measured distance become ray-marched volumes extruded from their image: a lens-shaped cloud for HII regions, a shell for planetary nebulae and supernova remnants. Seen face-on, their summed glow matches the photograph.
- **Non-3D pages** have a light animated starfield, and the 3D view pauses while Explore covers it.

## Travel and sharing (milestone 4)

- **Search.** One index covers the Sun, planets, Pluto and moons; 3,400 named stars, findable by proper name, Bayer or Flamsteed designation ("Alpha Centauri", "α Cen", "61 Cygni") or HIP number; 4,800 exoplanet hosts and 6,400 planets; Messier/NGC/IC objects; 7,800 named galaxies; satellites; constellations; and the scale levels. Matching ignores case, accents and spacing, so "m31", "M 31" and "ngc224" all find Andromeda.
- **Warp.** The camera turns to the target, then eases log(distance) along a timed curve. Speed builds up, peaks mid-way (millions of times the speed of light between galaxies; the HUD reads in *c*) and settles. The duration (1.4–7 s) grows with the orders of magnitude crossed, counting the scale you leave from. Over the last part the camera swings round to an arrival viewpoint:
  - planets and moons three-quarter lit;
  - galaxies 35° off face-on, tilted towards our side;
  - nebulae from the Earth side, as in photographs;
  - exoplanet systems 55° above the orbital plane.
- **Arriving at a star.** Any catalogue star can be visited. Close up it is drawn as a disc: temperature from B−V (Ballesteros 2012), radius from luminosity and a bolometric correction (Flower 1996 as corrected by Torres 2010), limb darkening and procedural granulation, with an exposure that adapts as the disc fills the view. Its catalogue point steps aside.
- **Exoplanet systems.** Each system has its planets on their real orbits, the conservative habitable zone (Kopparapu et al. 2014) and orbit lines. Planet sizes come from measured radii, or from mass via the Chen & Kipping (2017) relation. Planet looks are procedural, chosen from size and equilibrium temperature. Exoplanet hosts that are also HYG stars are snapped onto the HYG position, so the point, label and system coincide.
- **Moons.** 21 major moons, from Phobos to Charon, use mean orbital elements fitted to JPL Horizons over 1950–2050. The fit is a Keplerian ellipse in the planet's equatorial plane, with precessing node and apse and long-period librations; it recovers Mimas's ±43.5°, 70.8-year Mimas–Tethys resonance. Typical error is 0.01–0.2° along the orbit, about 0.7° for Phobos and Deimos. Moons are tidally locked, have procedural surfaces, and appear in Sky view at their apparent places with their own magnitudes.
- **Free flight.** WASD/QE flight, with speed proportional to the distance to the nearest object (solar-system bodies, stars, galaxies). The same keys therefore cross a few kilometres next to a moon and a megaparsec between galaxies, and one frame's step can never pass through the nearest surface. The camera re-anchors to whichever body's sphere of influence it is in, so precision and co-moving motion follow you.
- **Shareable links.** The address bar always holds the current view: camera, target, selection, simulated time and rate, and observer location. Objects are referenced by designation or name ("NGC 1952", "TRAPPIST-1 e", "HIP 32349"), not internal indexes, so links survive data rebuilds. Opening a link waits for the referenced catalogues to stream in.

## How the scale problem is handled

The scene spans about 27 orders of magnitude, from metres to gigaparsecs. No single coordinate system or depth buffer covers that range, so the engine uses four techniques:

1. **Nested reference frames, all in float64.** Every position is a pair: a frame plus a local offset. The frames are the solar-system barycentre, then Sun → planets, and Earth → Moon. `FrameGraph.difference()` adds offsets only up to the two points' lowest common ancestor, so precision depends on the distance *between* the points, not their distance from a global origin. A unit test holds 1.25 m precision at 3 Gpc from the root.
2. **Camera-relative rendering.** The GPU camera is always at the origin. Each frame, every object's camera-relative offset is computed in float64 and only then handed to float32. Bulk data such as stars stays as float32 *relative to its anchor*, and the shader receives the camera-to-anchor offset as a uniform.
3. **Depth.** The engine uses a reversed-Z, 32-bit float depth buffer when `EXT_clip_control` is available, and a logarithmic depth buffer otherwise. The perf overlay (`P`) shows which mode is active. Stars and constellation lines are drawn as directions on a far shell with no depth test.
4. **Log-space motion.** Zoom and travel act on log(altitude), so one wheel notch or one second of travel is the same *fraction* of the distance at any scale.
5. **A scale ladder.** As you zoom out, the orbit target hands over from the Sun to the Galactic Centre, then the Local Group, then the observer's own position at cosmological scale. Each hand-over keeps the camera where it is, so the motion stays continuous.

## Deep space (milestone 3)

- **Stars beyond the naked eye.** AT-HYG v4.0 (Gaia DR3 + Tycho-2, 2.4 million stars) is split into a magnitude-sorted octree of 2,119 tiles, 14 bytes per star. Every node holds the brightest stars of its volume, so the tiles fetched depend on distance and limiting magnitude (after Gaia Sky). Tiles decode in a worker pool and are cached in IndexedDB. At most 1.5 million stars are resident at once.
- **Photometry.** Every point source is drawn from its absolute magnitude and true distance through one PSF model, and an auto-exposure raises the limiting magnitude as the view widens. Galaxies use a separate reference magnitude tied to the viewing distance, so a cluster of thousands of galaxies doesn't saturate.
- **The Milky Way.**
  - From inside it you see the NASA SVS *Deep Star Maps 2020* panorama, built from Gaia DR2.
  - From outside you see a ray-marched volume: an exponential disc, a bar and bulge, four logarithmic spiral arms with dust lanes and HII regions. It is rendered at half resolution and composited into the scene.
  - The panorama fades between 300 and 2,000 pc as the volume fades in.
- **Nebulae and clusters.** OpenNGC objects are placed at their real distances where one is known: Harris for globulars, Cantat-Gaudin parallaxes for open clusters, and a curated table for the major nebulae. Nebulae are drawn from their survey images (see Explore, milestone 5), and the nearest become ray-marched volumes as you approach them. Objects with no distance are shown only as seen from the Solar System.
- **Galaxies.** 43,623 galaxies come from the 2MASS Redshift Survey. Distances come from McConnachie (Local Group), then Cosmicflows-4, then cz/H₀ (H₀ = 74.6). Sizes come from the K-band isophote, axis ratios and position angles from the catalogues. Nearby galaxies are drawn as 3D-oriented impostors with a morphology-dependent shader, and distant ones as points.
- **The cosmic web (procedural).** Beyond the surveyed volume (fading in from 230 to 330 Mpc), an implicit octree generates filaments, clusters and voids with a Schechter luminosity function. It is deterministic, generated in workers, and streams by distance out to the observable-universe horizon (14.25 Gpc comoving). There, a stylised CMB shell marks the edge.

## Positional astronomy (milestone 2)

- **Ephemerides.** JPL DE440 states from the Horizons API are re-fitted as Chebyshev series (`tools/build-ephemeris.mjs`), in 1.8 MB chunks of 50 years each. The chunk covering the current date loads first and its neighbours load in the background.
  - **Accuracy against Horizons, on dates outside the fitting grid:** under 10 km for Mercury through Mars, 0.1 km for the Moon, and under 800 km for the outer planets. That is below 0.05″ as seen from Earth.
  - **Outside 1900–2100, while a chunk loads, or if a load fails,** positions fall back to JPL's Keplerian elements and are labelled "approximate".
- **Earth orientation.**
  - IAU 2006 precession, using the Fukushima–Williams angles with frame bias.
  - A four-term nutation series.
  - Apparent sidereal time, and WGS84 coordinates for the observer.
- **Apparent places.** Light-time correction, annual plus diurnal aberration, then precession and nutation to RA/Dec of date, then alt/az, with Sæmundsson refraction.
  - Against Horizons, RA/Dec agree to within 0.2″ at every test epoch, from Auckland and from Greenwich.
  - Sky view draws planets, the Moon and stars at these apparent positions, so the picture matches the numbers in the info panel.
- **Events.** Rise, set, transit, twilight, Moon phase and satellite passes run in a Web Worker. Rise and set use the standard sea-level convention: the object's centre at −34′ minus its semi-diameter. Against interpolated Horizons data they agree to within 20 s.
- **Satellites.** Element sets come from CelesTrak (CORS-enabled) and are cached in IndexedDB for 2 h, with a bundled snapshot as fallback. They are propagated with SGP4 every frame. A satellite is shown only when sunlit and brighter than the sky allows.
- **Sky rendering.**
  - Single-scattering Rayleigh, Mie and ozone, computed into a 192×108 sky-view lookup table each frame (after Hillaire 2020).
  - Stellar extinction by airmass.
  - A limiting magnitude that follows twilight, plus a "sky darkness" setting for light pollution.

**Deliberate design choice:** per-frame body positions are evaluated on the main thread, not in a worker. Evaluating the Chebyshev series costs microseconds, while a worker round-trip would put planets a frame behind the camera at high time rates. The worker handles the expensive work instead: the event searches, which need hundreds of evaluations each.

## Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Stars (119,625) | [HYG Database v4.1](https://github.com/astronexus/HYG-Database), D. Nash | CC BY-SA 4.0; our binary re-encoding is shared under the same licence |
| Sun, Moon, planets, Pluto | JPL DE440 via the [Horizons API](https://ssd.jpl.nasa.gov/horizons/), re-fitted by us | Public domain |
| Constellation lines, boundaries, names | [d3-celestial](https://github.com/ofrohn/d3-celestial), O. Frohn | BSD 3-Clause |
| Cities for location search | [GeoNames](https://www.geonames.org/) cities ≥ 15,000 | CC BY 4.0 |
| Satellite element sets | [CelesTrak](https://celestrak.org/) | Free with attribution |
| SGP4 propagation | [satellite.js](https://github.com/shashwatak/satellite-js) | MIT |
| Planet textures | [Solar System Scope](https://www.solarsystemscope.com/textures/), based on NASA imagery | CC BY 4.0 |
| Fallback orbits | E. M. Standish, JPL, *Keplerian Elements for Approximate Positions of the Major Planets* | Public domain |
| Body orientation | IAU WGCCRE 2015 (Archinal et al. 2018) | n/a |
| Stars beyond HYG (2.4 M) | [AT-HYG v4.0](https://codeberg.org/astronexus/athyg), D. Nash, from Gaia DR3 and Tycho-2 | CC BY-SA 4.0; our octree re-encoding is shared under the same licence |
| Milky Way panorama | [NASA/GSFC SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851); Gaia DR2: ESA/Gaia/DPAC | NASA media guidelines, credit required |
| Galaxies (43,623) | [2MRS](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/ApJS/199/26) (Huchra et al. 2012), [Cosmicflows-4](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/ApJ/944/94) (Tully et al. 2023), [McConnachie 2012](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/AJ/144/4) | VizieR: free use with citation |
| Nebulae, clusters, galaxy names | [OpenNGC](https://github.com/mattiaverga/OpenNGC), M. Verga | CC BY-SA 4.0 |
| Exoplanets (6,423 in 4,819 systems) | [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/), Planetary Systems Composite Parameters | Public; acknowledgement requested (see attributions) |
| Major moons (21) | JPL Horizons satellite ephemerides, re-fitted by us as mean elements | Public domain |
| Nebula, cluster and galaxy images (439) | [Pan-STARRS1 DR1](https://outerspace.stsci.edu/display/PANSTARRS/) (338), [VPHAS+ DR4](https://www.eso.org/qi/) (31), [DECaPS2](http://decaps.skymaps.info/) (13), [SHASSA](https://amundsen.swarthmore.edu/) (32) and [VTSS](https://www.phys.vt.edu/~halpha/) (25) H-alpha, cut out with [CDS hips2fits](https://alasky.cds.unistra.fr/hips-image-services/hips2fits) | PS1: free with acknowledgement; VPHAS+: CC BY 4.0; DECaPS2: public, acknowledgement requested; SHASSA, VTSS: free with citation |
| Comets, asteroids, dwarf planets | [JPL Small-Body Database](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html) | Public domain |
| Planetary nebula distances | [Chornay & Walton 2021](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/A+A/656/A110) (Gaia EDR3) | VizieR: free use with citation |
| Black holes, neutron stars, facts | Published measurements, each cited in the app (EHT, GRAVITY, ATNF Pulsar Catalogue, Gaia …) | Facts; text is ours |
| Cluster distances | [Harris 2010](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/202) (globulars), [Cantat-Gaudin et al. 2020](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/A+A/640/A1) (open clusters) | VizieR: free use with citation |

Procedural content (cosmic web beyond ~300 Mpc, nebula depth, the Milky Way seen from outside) is generated, not observed, and is labelled "approximate" in the app.

The machine-readable list is [apps/web/public/data/attributions.json](apps/web/public/data/attributions.json), and the Settings panel shows it in the app.

## Known limitations

- **Earth rotation.** UT1 is taken as UTC. The difference is always under 0.9 s, which shifts alt/az by up to about 13″ (RA/Dec are unaffected). Polar motion is ignored.
- **Nutation** uses the four largest terms, which is good to about 0.5″.
- **Rise and set times** assume a sea-level horizon with no dip and standard refraction. Sky view does not draw refraction near the horizon, although the computed altitudes include it.
- **Moon orientation** omits libration's small periodic terms.
- **Atmosphere.**
  - Multiple scattering is a crude constant term.
  - There is no moonlight in the sky, and no light pollution glow beyond the limiting-magnitude setting.
  - Earth's atmosphere as seen from space is not rendered yet.
- **Satellites.** Magnitudes use standard magnitudes (known for the ISS, Tiangong and Hubble, otherwise a 4.0 default), so they are approximate. Passes count as "visible" when the satellite is sunlit at culmination and the Sun is below −6°.
- **Glare.** Very bright points (the Sun from the outer solar system, Earth from deep space) get large bloom halos.
- **Not yet built.**
  - Constellation artwork. Freely licensed art sets are copyleft (Stellarium's is Free Art License), so it needs its own licensing decision.
  - Proper motion. Stars sit at their J2000-epoch positions, which is off by up to about 4.5′ for the fastest-moving star (Barnard's) in 2026. Precession is handled correctly through Earth's orientation.
- **Deep space approximations.**
  - Galaxy distances from redshift alone smear clusters along the line of sight ("fingers of God"), which is clearly visible in Virgo and Coma. Cosmicflows-4 distances correct this only for the galaxies it covers.
  - Nebula volumes are extruded from their images, so they are right face-on but their depth is a guess. Nebulae without an image (about 90 southern objects outside the surveys' coverage, and the smallest catalogue entries) fall back to procedural shapes. The Milky Way seen from outside is a procedural model matched to the real galaxy's structure. The CMB shell is stylised, not the Planck map.
  - Nebula images are survey photographs in red and green bands (or H-alpha alone, shown in a red palette), not true colour. Up close, nebulae are drawn as bright as a long-exposure photograph, because to the eye an extended nebula is about as faint up close as from Earth.
  - The cosmic web beyond 2MRS is statistical. Its structures are plausible but not the real ones.
  - Stars have no individual extinction. The Galactic dust is only in the volumetric model.
- **Travel approximations.**
  - Exoplanet orbit orientations on the sky (longitude of the node) are not catalogued. They are seeded per system, so multi-planet systems stay coplanar. Where there is no transit or conjunction time, the planets' positions along their orbits are seeded too. Such planets are labelled "approximate".
  - Planet and moon surfaces beyond the textured planets are procedural. Moons without textures are tidally locked to their planets, including Nereid, which in reality isn't.
  - Other stars are drawn at their catalogue positions with no light-travel delay; exoplanet phases follow the same convention.
  - Free flight avoids solar-system bodies and stars. Galaxies are treated as points for speed control, so you can fly through them (as you could, in reality).
  - Opening a shared link sets your observer location to the link's.
- **Software rendering.** Without a GPU (SwiftShader), the deep-space scenes run at a few frames per second. Use the Low quality preset.
- **Explore.**
  - Generated facts can only be as good as the catalogue values behind them. A few archive values are wrong; for example, one exoplanet mass of 12,600 Earth masses for a planet 1.2 times Earth's radius is discarded.
  - Small bodies are 38 hand-picked objects with two-body orbits (no planetary perturbations), good to a fraction of a degree within a few years of their epochs.
  - Equipment advice is a simple magnitude rule; real visibility depends on surface brightness and your sky.
- **CelesTrak rate limits.** CelesTrak returns 403 after repeated downloads from one address. The app falls back to its cache and then to the bundled snapshot, and the tests never contact it.
- **Bundle size.** The JS bundle is not yet code-split. That is planned for milestone 6.

## Roadmap

1. ✅ Scaffold, floating-origin renderer, starfield, solar system
2. ✅ DE440 ephemerides, Sky view, atmosphere, constellations, satellites (SGP4), rise/set and passes
3. ✅ Zoom-out: Gaia tiles, nebulae, Milky Way, Local Group, cosmic web
4. ✅ Free flight, warp-to, command palette, shareable URLs, moons, star systems and exoplanets
5. ✅ Explore/catalogue tab with facts and "where to find it"; image-based nebulae; comets, asteroids, black holes and pulsars
6. Polish, performance, PWA/offline, themes, full documentation
