# Simuverse

A realistic, explorable 3D universe in the browser, from your own sky out to the cosmic web.

Simuverse opens on the real sky over your location, right now:

- the Sun, Moon and planets from JPL DE440, at their apparent places to about an arcsecond;
- an atmosphere that follows the time of day, and a horizon;
- constellations (lines, boundaries and artwork) and bright satellites;
- rise and set times for everything.

Scroll out and you leave the ground. The zoom passes through the Solar System and 2.4 million Gaia/Tycho stars, past nebulae drawn from survey photographs, to the Milky Way, the Local Group, the Virgo Supercluster, Laniakea and the edge of the observable universe.

You can also:

- search for anything (**Ctrl/⌘ K**) and warp there;
- fly freely;
- browse a catalogue of about 23,000 objects with facts and "where to find it" for tonight;
- share a link to exactly what you see.

It installs as an offline-capable app.

All six milestones of the original plan are done (see [Roadmap](#roadmap)).

## Contents

- [Quick start](#quick-start)
- [What's in it](#whats-in-it)
- [Controls](#controls)
- [How it works](#how-it-works)
- [Performance](#performance)
- [Offline use and deployment](#offline-use-and-deployment)
- [Browser support](#browser-support)
- [Testing](#testing)
- [Data sources and licences](#data-sources-and-licences)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # static build in apps/web/dist; host anywhere
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # browser tests (Playwright; builds and serves the app, software GL)
```

Requires Node 20+ and pnpm 10, plus a browser with WebGL 2. See [Testing](#testing) for the GPU and cross-browser test runs.

Generated data is committed, so a fresh clone runs without downloading anything. To regenerate it from the public sources (downloads are cached in `.cache/`):

```bash
pnpm data:stars             # HYG v4.1 → stars-hyg.bin (+ names)
pnpm data:stars-octree      # AT-HYG v4.0 (2.4 M stars, ~200 MB download) → data/stars/ octree tiles
pnpm data:ephemeris         # JPL Horizons (DE440) samples → Chebyshev chunks, 1900–2100 (~170 MB download)
pnpm data:moons             # JPL Horizons vectors (1950–2050) → fitted mean elements for 21 moons (packages/astro)
pnpm data:sky               # constellations (d3-celestial), cities (GeoNames), TLE snapshot (CelesTrak)
pnpm data:constellation-art # Stellarium modern sky culture artwork → atlas + sky meshes
pnpm data:textures          # Solar System Scope 2K planet textures
pnpm data:galaxies          # 2MRS + Cosmicflows-4 + McConnachie + OpenNGC (VizieR) → galaxies.bin
pnpm data:deepsky           # OpenNGC nebulae and clusters; Harris, Cantat-Gaudin, Chornay & Walton distances
pnpm data:milkyway          # NASA SVS Deep Star Maps 2020 (8K EXR, ~140 MB) → 4K Milky Way panorama
pnpm data:exoplanets        # NASA Exoplanet Archive (pscomppars) → exoplanets.json
pnpm data:smallbodies       # JPL Small-Body Database → smallbodies.json
pnpm data:images            # CDS hips2fits survey cutouts → data/images/ (nebula, cluster and galaxy images)
pnpm data:fixtures          # JPL Horizons reference values for the astro tests
```

## What's in it

### Sky view

- **Where you are.** Your location comes from browser geolocation (with permission), a city search, or the largest city in your time zone.
- **What you see.**
  - The sky is drawn for the current time, or for any date from 1900 to 2100 at up to a million times real speed, forwards or backwards.
  - Single-scattering Rayleigh, Mie and ozone atmosphere, computed into a sky-view lookup table each frame (after Hillaire 2020).
  - Stars dim with airmass, and the limiting magnitude follows twilight. A "sky darkness" setting stands in for light pollution.
- **Constellations.** Lines (`K`), IAU boundaries (`B`) and artwork (`U`); the artwork is Stellarium's modern figures by Johan Meuris.
- **Satellites.** The ISS and other bright satellites are propagated with SGP4 from CelesTrak element sets, and shown only when sunlit.
- **Object details.** Selecting anything shows:
  - its alt/az, RA/Dec (J2000 and of date), distance with light-travel time, and magnitude;
  - today's rise, transit and set times;
  - visible passes for satellites.

### Universe view and travel

- **One continuous zoom.** The scroll wheel goes from a few metres above the ground to the observable universe with no loading screens. The *cosmic address* breadcrumb jumps straight to any scale.
- **Warp.** Warp to anything with a log-speed curve. The HUD reads speed in multiples of *c*; between galaxies it is millions of times light speed.
- **Arrival viewpoints.**
  - Planets and moons: three-quarter lit.
  - Galaxies: tilted towards our side.
  - Nebulae: seen from the Earth side, as in photographs.
  - Exoplanet systems: from above their orbits.
- **Free flight (`F`).** WASD/QE flight with speed proportional to the distance to the nearest object. The same keys cover a few kilometres near a moon and a megaparsec between galaxies.
- **Stars up close.** Any catalogue star can be visited and is drawn as a limb-darkened, granulated disc of the right colour and size.
- **Exoplanets.** 4,800 exoplanet systems from the NASA Exoplanet Archive, with real orbits, the conservative habitable zone (Kopparapu et al. 2014), and planets sized from measured radii or from mass (Chen & Kipping 2017).
- **Moons.** 21 major moons on orbits fitted to JPL Horizons.
- **Small bodies.** Dwarf planets, notable asteroids, periodic and great comets, and 1I/ʻOumuamua and 2I/Borisov.
- **Shareable links.** The address bar always describes the current view: camera, target, selection, time and rate, and observer location. Objects are referenced by name or designation, so links survive data rebuilds.
- **Lens flare.** An optional flare from the Sun (Settings). It hides when a planet or the ground covers the Sun.

### Deep space

- **Stars beyond the naked eye.** 2.4 million stars from AT-HYG v4.0 (Gaia DR3 + Tycho-2) stream in as a magnitude-sorted octree (after Gaia Sky).
- **Photometry.** Every point source is drawn from its true luminosity and distance through one PSF model, with auto-exposure.
- **The Milky Way.**
  - From inside it is the NASA SVS *Deep Star Maps 2020* panorama.
  - From outside it is a ray-marched volume: disc, bar, bulge, four spiral arms, dust lanes and HII regions.
- **Nebulae and clusters.**
  - OpenNGC objects are placed at measured distances where known.
  - 439 of them, plus the brightest galaxies, are drawn from their own survey photographs (Pan-STARRS1, VPHAS+, DECaPS2; SHASSA and VTSS H-alpha for the largest). The stars, satellite streaks and saturation bleeds are removed from each photograph.
  - Up close, nebulae become ray-marched volumes extruded from their image: lens-shaped clouds for HII regions, shells for planetary nebulae and supernova remnants.
- **Galaxies.**
  - 43,623 galaxies from the 2MASS Redshift Survey, with distances from McConnachie (Local Group), Cosmicflows-4, or redshift.
  - Nearby galaxies are drawn as oriented, morphology-dependent impostors.
- **The cosmic web.** Beyond the surveyed volume (from about 300 Mpc) it is procedural: deterministic filaments, clusters and voids with a Schechter luminosity function. It is labelled "approximate".

### Explore

- **The catalogue.** About 23,000 objects, searchable, filterable and sortable in a virtualised list:
  - the Sun, planets and moons; 3,400 named stars;
  - 6,400 exoplanets; nebulae, clusters and supernova remnants; galaxies;
  - 38 comets, asteroids and dwarf planets;
  - 16 black holes and neutron stars.
- **Each entry** shows:
  - an image, type, distance, size, mass or luminosity, temperature, discovery and constellation;
  - **where to find it**: RA/Dec, where it is right now, when it is highest tonight, the best season, and whether you need eyes, binoculars or a telescope;
  - 2–5 facts with their sources. About 140 objects have curated facts, and the rest are generated from catalogue values.
- **Lists.** Highlights with a featured object of the day, Visible tonight, Closest, Most extreme, Favourites and Visited (kept in IndexedDB).
- **Actions.** **Go there** warps to the object; **Show in my sky** turns Sky view to it.

### Interface

- **Layout.**
  - A full-screen 3D view.
  - A collapsible left navigation (Universe, Sky, Explore, Settings).
  - An object panel on the right, search on top, and time controls at the bottom.
- **Themes.** Deep space (default), red night vision (the whole page, canvas included, in dim red to protect dark adaptation) and high contrast.
- **Accessibility.**
  - Everything is keyboard accessible, and `prefers-reduced-motion` is respected; the Settings switch can override it.
  - Windows from 1280 px wide upwards are supported.
- **Screenshots.** `C` saves the 3D view as a PNG.

## Controls

| Input | Sky view | Universe view |
|---|---|---|
| Drag / arrow keys | Look around | Orbit the focused body |
| Scroll / `+` `−` | Zoom (100° down to 1.2′); keep zooming out to lift off | Zoom (logarithmic) |
| Click / double-click | Select / centre a star, planet or satellite | Select; click a body to travel to it |
| `0`–`9` | Select and turn to Sun, Mercury…Neptune, Moon | Travel to them |
| `K` `U` `B` | Constellation lines, artwork, boundaries | |
| `G` `A` | Ground, atmosphere | |
| `Space`, `[` `]`, `N` | Pause, slower/reverse, faster, jump to now | |
| Breadcrumbs / left panel | | Jump to any scale: Milky Way, Local Group, Virgo, Laniakea, Observable Universe |
| `Ctrl`/`⌘` `K` or `/` | Search; `Enter` shows it in the sky, `Shift`+`Enter` goes there | Search; `Enter` goes there, `Shift`+`Enter` shows it in your sky |
| `R` | Surprise me: warp somewhere interesting | |
| `F` | | Free flight on/off: `W` `A` `S` `D` move, `Q` `E` down/up, `Shift` boost, drag to look, scroll sets speed |
| Link button / address bar | The URL always describes the current view; the link button copies it | |
| Explore (left panel) | Catalogue: lists, search, facts, "Go there", "Show in my sky", favourites | |
| `L` `O` `I` `P` `C` `Esc` `?` | Labels, orbits, info panel, perf overlay, screenshot, clear selection, help | |

## How it works

### Layout

```
apps/web          React UI (Vite, Tailwind v4, Zustand), service worker (sw.template.js + serviceWorkerPlugin.ts)
packages/astro    Pure, tested astronomy: time scales, frames, DE440 Chebyshev evaluation, Earth orientation,
                  apparent places, rise/set, magnitudes, SGP4 wrapper, fitted moon orbits, small-body orbits,
                  stellar physics, exoplanet orbits and habitable zones
packages/engine   Three.js renderer: frame graph, camera rigs (sky, orbit with warp, free flight), layers and
                  shaders, star systems, small bodies, search and view state, adaptive resolution, sky-events worker
packages/data     Loaders: star catalogue and octree tiles, galaxies, deep-sky objects and images, procedural
                  cosmic web (tile workers), exoplanets, small bodies, black holes and pulsars, catalogue and
                  facts, name search, ephemeris chunks, constellations and artwork, places, TLEs; IndexedDB
                  (Dexie) caches, favourites and visits
tools/            Node scripts that build the data files from their public sources
```

### The scale problem

The scene spans about 27 orders of magnitude, from metres to gigaparsecs. No single coordinate system or depth buffer covers that range, so the engine combines five techniques:

1. **Nested reference frames, all in float64.**
   - Every position is a pair: a frame plus a local offset. The frames are the solar-system barycentre, then Sun → planets, and Earth → Moon.
   - `FrameGraph.difference()` adds offsets only up to the two points' lowest common ancestor. Precision therefore depends on the distance *between* the points, not their distance from a global origin.
   - A unit test holds 1.25 m precision at 3 Gpc from the root.
2. **Camera-relative rendering.**
   - The GPU camera is always at the origin. Each frame, every object's camera-relative offset is computed in float64 and only then handed to float32.
   - Bulk data such as stars stays as float32 *relative to its anchor*, and the shader receives the camera-to-anchor offset as a uniform.
3. **Depth.**
   - The engine uses a reversed-Z, 32-bit float depth buffer when `EXT_clip_control` is available, and a logarithmic depth buffer otherwise. The perf overlay (`P`) shows which mode is active.
   - Stars, constellations and the Milky Way are drawn as directions on a far shell with no depth test.
4. **Log-space motion.** Zoom and travel act on log(altitude), so one wheel notch or one second of travel is the same *fraction* of the distance at any scale.
5. **A scale ladder.** Zooming out hands the orbit centre from the Sun to the Galactic Centre, then the Local Group, then the observer's own position at cosmological scale. Each hand-over keeps the camera where it is, so the motion stays continuous.

### Positional astronomy

- **Ephemerides.** JPL DE440 states from the Horizons API are re-fitted as Chebyshev series, in 1.8 MB chunks of 50 years.
  - **Accuracy against Horizons on dates outside the fitting grid:** under 10 km for Mercury through Mars, 0.1 km for the Moon, and under 800 km for the outer planets. All of these are below 0.05″ as seen from Earth.
  - **Outside 1900–2100, or while a chunk loads,** positions fall back to JPL's Keplerian elements and are labelled "approximate".
- **Earth orientation.** IAU 2006 precession (Fukushima–Williams angles with frame bias), a four-term nutation series, apparent sidereal time, and WGS84 coordinates for the observer.
- **Apparent places.** Light-time, annual and diurnal aberration, precession and nutation to RA/Dec of date, then alt/az with Sæmundsson refraction. Against Horizons, RA/Dec agree to within 0.2″ at every test epoch.
- **Events.** Rise, set, transit, twilight, Moon phase and satellite passes are searched in a Web Worker. Against interpolated Horizons data they agree to within 20 s.
- **Design choice:** per-frame body positions are evaluated on the main thread. The Chebyshev series costs microseconds, while a worker round-trip would put planets a frame behind the camera at high time rates.

### Streaming and workers

- **Star tiles.** Gaia/Tycho tiles are fetched by distance and limiting magnitude, decoded in a worker pool with transferable buffers, and cached in IndexedDB (a 200 MB LRU).
- **Cosmic web.** The procedural web is generated in the same workers.
- **Ephemeris.** The chunk for the current date loads first, and its neighbours follow in the background.

## Performance

The render loop is designed to hold 60 fps.

**Quality presets** (Low, Medium, High, Ultra) set:

- the pixel-ratio cap;
- MSAA;
- bloom;
- the ray-march steps and resolution of the volumes;
- the star budget (0.4–2.5 million resident stars);
- the procedural-galaxy budget.

**Adaptive resolution** (on by default) lowers the render scale, down to 50%, when frames stay below about 45 fps for more than 1.5 s:

- it raises the scale again in 10% steps when there is headroom;
- after an upward step that fails, it waits twice as long before the next try, so the resolution doesn't pump.

**Measured.** The perf overlay (`P`) shows fps, CPU and GPU time per frame (GPU time where the browser supports `EXT_disjoint_timer_query_webgl2`), draw calls and the render scale. On a laptop RTX 3050 (Chrome, uncapped frame rate), across 13 scenes from the sky to the observable universe:

| Window and preset | Slowest scene | Fastest scene |
|---|---|---|
| 1600×900, High | 134 fps (Virgo cluster: 268,000 procedural galaxies) | 434 fps (wide sky) |
| 3840×2160, Ultra | 88 fps (Earth close-up) | 158 fps (Local Group) |

Main-thread time stays under 5 ms at 1600×900.

**Bundle.** The JavaScript is split so that the large, rarely changing parts cache separately:

| Chunk | Contents | Size (gzipped) |
|---|---|---|
| three.js | | 138 kB |
| vendor | React, Dexie, SGP4 | 111 kB |
| app | the app itself | 101 kB |
| Explore page | including its curated facts; loads on first open | 18 kB |

**Explore** pauses 3D rendering while it covers the view.

## Offline use and deployment

The production build is an installable PWA (`manifest.webmanifest` with icons, and a service worker).

**The service worker** is generated at build time by `apps/web/serviceWorkerPlugin.ts` from `sw.template.js`:

- **Precached on install (about 25 MB):**
  - the app shell (every emitted JS and CSS file);
  - the core data: catalogues, constellation lines and art, the ephemeris chunk for the current era, the Milky Way panorama, planet textures, and the image index and atlas.
- **Cached on use, up to 400 files:** everything else under `data/` and `textures/`, served stale-while-revalidate.
- **Not handled:** Gaia star tiles, which the app keeps in IndexedDB.
- **Versioning.**
  - The worker's version is a hash of everything it precaches, so any change to the app or the core data installs a new one.
  - A new version waits until the user accepts the "new version" prompt, so a running page never loses its lazily loaded chunks.

Settings → Offline shows whether the app is ready offline and how much the site stores.

**Deploying.** `pnpm build` produces a static site in `apps/web/dist`; any static host works, and no backend or proxy is needed.

- **HTTPS is required** for the service worker (localhost is exempt).
- **Cache headers.** Serve `sw.js` and `index.html` with `Cache-Control: no-cache`. Files under `assets/` are content-hashed and can be cached for a year. Data files are not hashed, so give them a short cache or `no-cache`.
- **A sub-path** needs the base path set at build time: `SIMUVERSE_BASE=/your-path/ pnpm build`. All paths, the worker scope and the manifest follow it.
- **CelesTrak** element sets are fetched directly from the browser (CelesTrak allows cross-origin requests). If that fails, the app uses its 2-hour IndexedDB cache, then the bundled snapshot.

**GitHub Pages.** [.github/workflows/deploy.yml](.github/workflows/deploy.yml) publishes the site on every push to `master` (or on demand from the Actions tab). It type-checks, runs the unit tests, builds under `/<repo>/`, and deploys to `https://<user>.github.io/<repo>/`.

- **One-time setup:** in the repository's Settings → Pages, set Source to "GitHub Actions".
- **Plan:** Pages needs a public repository on GitHub's free plan.
- **Caching:** Pages caches every file for 10 minutes and the headers can't be changed. A new deployment therefore reaches visitors within about 10 minutes, as the in-app "new version" prompt.

## Browser support

| Browser | Status |
|---|---|
| Chrome, Edge (Chromium) | Primary target. Full test suite, on the GPU and in software GL. |
| Firefox | Smoke-tested (Playwright's Firefox build). It has no `EXT_clip_control`, so it uses the logarithmic depth buffer. |
| Safari (WebKit) | Smoke-tested in Playwright's WebKit build on Windows, which renders in software (about 30 fps with adaptive resolution). Not yet tried on a Mac. |

WebGL 2 is required; without it the app explains that the 3D view can't start. WebGPU (optional in the original brief) is not used.

## Testing

```bash
pnpm test                                   # 393 unit tests (Vitest): astronomy against JPL values, data, engine logic, UI lists
pnpm test:e2e                               # Playwright, Chromium with software GL (slow but works anywhere)
SIMUVERSE_E2E_GPU=1 pnpm test:e2e           # the same on the machine's GPU (much faster)
SIMUVERSE_E2E_BROWSERS=all pnpm test:e2e    # also the smoke test in Firefox and WebKit
                                            # (first: npx playwright install firefox webkit)
```

The browser tests cover:

- the sky, time travel and city search;
- zooming through every scale;
- search, warp, free flight and shareable links;
- exoplanets, moons and comets;
- the Explore lists, favourites (across reloads) and visits;
- constellation art;
- offline start and the update prompt.

Every browser test fails on any console error. The tests never contact CelesTrak: a bundled snapshot is served instead.

## Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Stars (119,625) | [HYG Database v4.1](https://github.com/astronexus/HYG-Database), D. Nash | CC BY-SA 4.0; our binary re-encoding is shared under the same licence |
| Stars beyond HYG (2.4 M) | [AT-HYG v4.0](https://codeberg.org/astronexus/athyg), D. Nash, from Gaia DR3 and Tycho-2 | CC BY-SA 4.0; our octree re-encoding is shared under the same licence |
| Sun, Moon, planets, Pluto | JPL DE440 via the [Horizons API](https://ssd.jpl.nasa.gov/horizons/), re-fitted by us | Public domain |
| Major moons (21) | JPL Horizons satellite ephemerides, re-fitted by us as mean elements | Public domain |
| Comets, asteroids, dwarf planets | [JPL Small-Body Database](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html) | Public domain |
| Fallback orbits | E. M. Standish, JPL, *Keplerian Elements for Approximate Positions of the Major Planets* | Public domain |
| Body orientation | IAU WGCCRE 2015 (Archinal et al. 2018) | n/a |
| Constellation lines, boundaries, names | [d3-celestial](https://github.com/ofrohn/d3-celestial), O. Frohn | BSD 3-Clause |
| Constellation artwork | [Stellarium](https://github.com/Stellarium/stellarium/tree/master/skycultures/modern) modern sky culture: illustrations by Johan Meuris; anchor data by the Stellarium team | Free Art License 1.3 (art; our resampled atlas is shared under the same licence); CC BY-SA 4.0 (data) |
| Cities for location search | [GeoNames](https://www.geonames.org/) cities ≥ 15,000 | CC BY 4.0 |
| Satellite element sets | [CelesTrak](https://celestrak.org/) | Free with attribution |
| SGP4 propagation | [satellite.js](https://github.com/shashwatak/satellite-js) | MIT |
| Planet textures | [Solar System Scope](https://www.solarsystemscope.com/textures/), based on NASA imagery | CC BY 4.0 |
| Milky Way panorama | [NASA/GSFC SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851); Gaia DR2: ESA/Gaia/DPAC | NASA media guidelines, credit required |
| Galaxies (43,623) | [2MRS](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/ApJS/199/26) (Huchra et al. 2012), [Cosmicflows-4](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/ApJ/944/94) (Tully et al. 2023), [McConnachie 2012](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/AJ/144/4) | VizieR: free use with citation |
| Nebulae, clusters, galaxy names | [OpenNGC](https://github.com/mattiaverga/OpenNGC), M. Verga | CC BY-SA 4.0 |
| Cluster distances | [Harris 2010](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/202) (globulars), [Cantat-Gaudin et al. 2020](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/A+A/640/A1) (open clusters) | VizieR: free use with citation |
| Planetary nebula distances | [Chornay & Walton 2021](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/A+A/656/A110) (Gaia EDR3) | VizieR: free use with citation |
| Nebula, cluster and galaxy images (439) | [Pan-STARRS1 DR1](https://outerspace.stsci.edu/display/PANSTARRS/) (338), [VPHAS+ DR4](https://www.eso.org/qi/) (31), [DECaPS2](https://datalab.noirlab.edu/data/decaps) (13; Saydjari et al. 2023, NSF NOIRLab/CTIO), [SHASSA](https://amundsen.swarthmore.edu/) (32) and [VTSS](https://www.phys.vt.edu/~halpha/) (25) H-alpha, cut out with [CDS hips2fits](https://alasky.cds.unistra.fr/hips-image-services/hips2fits) | PS1: free with acknowledgement; VPHAS+: CC BY 4.0; DECaPS2: public, with the [NOIRLab/DECam acknowledgement](https://datalab.noirlab.edu/decaps/acknowledgments.php); SHASSA, VTSS: free with citation |
| Exoplanets (6,423 in 4,819 systems) | [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/), Planetary Systems Composite Parameters | Public; acknowledgement requested |
| Black holes, neutron stars, facts | Published measurements, each cited in the app (EHT, GRAVITY, ATNF Pulsar Catalogue, Gaia …) | Facts; text is ours |

**Where the attributions live.**

- The machine-readable list, including the full acknowledgement texts that PS1, VPHAS+, DECaPS2 and the NASA Exoplanet Archive ask for, is [apps/web/public/data/attributions.json](apps/web/public/data/attributions.json).
- Settings → Data & credits shows it in the app, with each acknowledgement under its source.

**Generated content.** The cosmic web beyond ~300 Mpc, nebula depth, the Milky Way seen from outside, and surfaces of untextured moons and exoplanets are generated, not observed. They are labelled "approximate" in the app.

## Known limitations

- **Positional astronomy.**
  - UT1 is taken as UTC (under 0.9 s difference, so alt/az is off by up to about 13″), and polar motion is ignored.
  - Nutation uses the four largest terms, good to about 0.5″.
  - Rise and set times assume a sea-level horizon with standard refraction. Sky view does not draw refraction near the horizon, although the computed altitudes include it.
  - The Moon's orientation omits libration's small periodic terms.
  - Stars sit at their J2000 positions with no proper motion: up to about 4.5′ off for Barnard's Star in 2026.
- **Atmosphere.**
  - Multiple scattering is a crude constant term.
  - There is no moonlight in the sky, and no light-pollution glow beyond the limiting-magnitude setting.
  - Earth's atmosphere is not rendered as seen from space.
- **Satellites.** Magnitudes use standard magnitudes (known for the ISS, Tiangong and Hubble, otherwise a 4.0 default). A pass counts as "visible" when the satellite is sunlit at culmination and the Sun is below −6°.
- **Deep space.**
  - **Galaxy distances.** Distances from redshift alone smear clusters along the line of sight ("fingers of God"), which is clearly visible in Virgo and Coma. Cosmicflows-4 corrects only the galaxies it covers.
  - **Nebula shapes.** Nebula volumes are extruded from their images, so they are right face-on but their depth is a guess. About 90 southern objects outside the surveys' coverage, and the smallest catalogue entries, fall back to procedural shapes.
  - **Nebula colours.** Nebula images are survey photographs in red and green bands, or H-alpha shown in a red palette, not true colour. Up close, nebulae are drawn as bright as a long exposure; to the eye they would stay about as faint as from Earth.
  - **Procedural content.** The cosmic web beyond 2MRS is statistical: plausible, but not the real structures. The CMB shell is stylised, not the Planck map.
  - **Extinction.** Stars have no individual extinction; the Galactic dust is only in the volumetric model.
- **Travel.**
  - **Exoplanet orientations.** These are not catalogued, so they are seeded per system (keeping multi-planet systems coplanar). Planets without a transit or conjunction time get seeded positions along their orbits. Both cases are labelled "approximate".
  - **Surfaces.** Surfaces beyond the textured planets are procedural. Untextured moons are tidally locked to their planets, including Nereid, which in reality isn't.
  - **Light travel.** Other stars are drawn with no light-travel delay.
  - **Free flight.** Galaxies count as points for speed control, so you can fly through them.
  - **Shared links.** Opening a shared link sets your observer location to the link's.
- **Explore.**
  - Generated facts are only as good as the catalogue values behind them. One known-bad archive value, an exoplanet mass of 12,600 Earth masses for a planet 1.2 times Earth's radius, is discarded.
  - Small bodies are 38 hand-picked objects on two-body orbits, good to a fraction of a degree within a few years of their epochs.
  - Equipment advice is a simple magnitude rule; real visibility depends on surface brightness and your sky.
- **Constellation art.**
  - Each figure is placed with an affine map through three anchor stars, so its edges can drift by a degree or two from where Stellarium draws them.
  - Serpens, Puppis and Vela have no artwork in the source set.
- **Rendering.**
  - Very bright points get large bloom halos: the Sun from the outer Solar System, or Earth from deep space.
  - Without a GPU (SwiftShader, or WebKit on Windows), the deep-space scenes are slow even at reduced resolution. Use the Low preset.
- **CelesTrak** returns 403 after repeated downloads from one address. The app then falls back to its cache and the bundled snapshot.

## Roadmap

1. ✅ Scaffold, floating-origin renderer, starfield, solar system
2. ✅ DE440 ephemerides, Sky view, atmosphere, constellations, satellites (SGP4), rise/set and passes
3. ✅ Zoom-out: Gaia tiles, nebulae, Milky Way, Local Group, cosmic web
4. ✅ Free flight, warp-to, command palette, shareable URLs, moons, star systems and exoplanets
5. ✅ Explore/catalogue tab with facts and "where to find it"; image-based nebulae; comets, asteroids, black holes and pulsars
6. ✅ Polish and performance (adaptive resolution, code splitting, GPU timing), PWA/offline, themes, constellation art, lens flare, cross-browser checks, documentation

Possible next steps:

- WebGPU rendering;
- proper motion;
- Earth's atmosphere seen from space;
- moonlight and light pollution in the sky model;
- more small bodies (from the full SBDB);
- testing on Safari for macOS.
