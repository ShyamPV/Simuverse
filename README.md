# Simuverse

A realistic, explorable 3D universe in the browser, from your own sky out to the cosmic web.

> **Status: milestone 3 of 6.** The app opens on the real sky over your location: DE440 ephemerides, apparent positions to about an arcsecond, an atmosphere and horizon, constellations, satellites, and rise/set times. Keep zooming out and you leave Earth, cross the solar system, pass through 2.4 million Gaia/Tycho stars and nearby nebulae, see the Milky Way from outside, then the Local Group, the Virgo Cluster, Laniakea and the observable universe. See [Roadmap](#roadmap).

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
| `L` `O` `I` `P` `C` `Esc` `?` | Labels, orbits, info panel, perf overlay, screenshot, clear selection, help | |

## Layout

```
apps/web          React UI (Vite, Tailwind v4, Zustand)
packages/astro    Pure, tested astronomy: time scales, frames, DE440 Chebyshev evaluation, Earth
                  orientation, apparent places, rise/set, magnitudes, SGP4 wrapper
packages/engine   Three.js renderer: frame graph, camera rigs, layers, shaders, sky-events worker
packages/data     Loaders: star catalogue and octree tiles, galaxies, deep-sky objects, procedural cosmic web
                  (tile workers), ephemeris chunks, constellations, places, TLEs (Dexie cache)
tools/            Node scripts that build the data files from their public sources
```

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
- **Nebulae and clusters.** OpenNGC objects are placed at their real distances where one is known: Harris for globulars, Cantat-Gaudin parallaxes for open clusters, and a curated table for the major nebulae. Nebulae are textured billboards, and the three nearest become ray-marched volumes when you approach them. Objects with no distance are shown only as seen from the Solar System.
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
| Cluster distances | [Harris 2010](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/202) (globulars), [Cantat-Gaudin et al. 2020](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/A+A/640/A1) (open clusters) | VizieR: free use with citation |

Procedural content (cosmic web beyond ~300 Mpc, nebula shapes, the Milky Way seen from outside) is generated, not observed, and is labelled "approximate" in the app.

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
  - Nebula shapes and the Milky Way seen from outside are procedural models matched to the real objects' sizes and orientations, not reconstructions. The CMB shell is stylised, not the Planck map.
  - The cosmic web beyond 2MRS is statistical. Its structures are plausible but not the real ones.
  - Stars have no individual extinction. The Galactic dust is only in the volumetric model.
- **Software rendering.** Without a GPU (SwiftShader), the deep-space scenes run at a few frames per second. Use the Low quality preset.
- **CelesTrak rate limits.** CelesTrak returns 403 after repeated downloads from one address. The app falls back to its cache and then to the bundled snapshot, and the tests never contact it.
- **Bundle size.** The JS bundle is not yet code-split. That is planned for milestone 6.

## Roadmap

1. ✅ Scaffold, floating-origin renderer, starfield, solar system
2. ✅ DE440 ephemerides, Sky view, atmosphere, constellations, satellites (SGP4), rise/set and passes
3. ✅ Zoom-out: Gaia tiles, nebulae, Milky Way, Local Group, cosmic web
4. Free flight, warp-to, command palette, shareable URLs
5. Explore/catalogue tab with facts and "where to find it"
6. Polish, performance, PWA/offline, themes, full documentation
