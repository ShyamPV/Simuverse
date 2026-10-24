# Simuverse

A realistic, explorable 3D universe in the browser, from your own sky out to the cosmic web.

> **Status: milestone 1 of 6.** This covers the scaffold, the floating-origin renderer, the real star catalogue and the solar system on Keplerian orbits. See [Roadmap](#roadmap).

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # browser tests (Playwright; builds and serves the app)
pnpm build        # static build in apps/web/dist; host anywhere
```

Requires Node 20+ and pnpm 10, plus a browser with WebGL 2.

Generated data is committed, so a fresh clone runs without downloading anything. To regenerate it:

```bash
pnpm data:stars     # HYG v4.1 → apps/web/public/data/stars-hyg.bin (+ names)
pnpm data:textures  # Solar System Scope 2K planet textures
pnpm data:fixtures  # JPL Horizons reference vectors for the astro tests
```

## Controls

| Input | Action |
|---|---|
| Drag / arrow keys | Orbit the focused object |
| Scroll / `+` `−` | Zoom (continuous, logarithmic) |
| Click a body or label, `0`–`9` | Focus Sun, Mercury … Neptune, Moon |
| `Space`, `[` `]`, `N` | Pause, slower/reverse, faster, jump to now |
| `L` `O` `I` `P` | Labels, orbits, info panel, performance overlay |
| `C` | Save screenshot |
| `?` | All shortcuts |

## Layout

```
apps/web          React UI (Vite, Tailwind v4, Zustand)
packages/astro    Pure astronomy maths: units, time scales, frames, Kepler, ephemerides, photometry
packages/engine   Three.js renderer: frame graph, camera rig, layers, shaders
packages/data     Catalogue decoding (in Web Workers) and, later, tile streaming and caching
tools/            Node scripts that turn raw catalogues into compact binary assets
```

## How the scale problem is handled

The scene spans about 27 orders of magnitude, from metres to gigaparsecs. No single coordinate system or depth buffer covers that range, so the engine uses four techniques:

1. **Nested reference frames, all in float64.** Every position is a pair: a frame (Sun, Earth, Moon, and later stars and galaxies) plus a local offset. `FrameGraph.difference()` adds offsets only up to the two points' lowest common ancestor, so precision depends on the distance *between* the points rather than their distance from a global origin. There is a unit test that holds 1.25 m precision three gigaparsecs from the root.
2. **Camera-relative rendering.** The GPU camera is always at the origin. Each frame, every object's camera-relative offset is computed in float64 and only then handed to float32. Bulk data such as stars stays as float32 *relative to its anchor*, and the shader receives the camera-to-anchor offset as a uniform.
3. **Depth.** The engine uses a reversed-Z, 32-bit float depth buffer when `EXT_clip_control` is available, and a logarithmic depth buffer otherwise. The HUD's perf overlay (`P`) shows which mode is active. Stars render as directions on a far shell with no depth test, so they never compete for depth precision.
4. **Log-space motion.** Zoom and travel act on log(altitude), so one wheel notch or one second of travel is the same *fraction* of the distance at any scale.

## Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Stars (119,625) | [HYG Database v4.1](https://github.com/astronexus/HYG-Database), D. Nash | CC BY-SA 4.0; our binary re-encoding is shared under the same licence |
| Planet textures | [Solar System Scope](https://www.solarsystemscope.com/textures/), based on NASA imagery | CC BY 4.0 |
| Planet orbits | E. M. Standish, JPL, *Keplerian Elements for Approximate Positions of the Major Planets* | Public domain |
| Moon | Astronomical Almanac low-precision formulae | n/a |
| Body orientation | IAU WGCCRE 2015 (Archinal et al. 2018) | n/a |
| Test reference values | [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Public domain |

The machine-readable list lives in [apps/web/public/data/attributions.json](apps/web/public/data/attributions.json), and the Settings panel shows it in the app.

## Known limitations (milestone 1)

- **Accuracy.**
  - Planet positions use Keplerian elements, valid 1800–2050. Measured against Horizons, the error is within 0.02° for the inner planets and within 0.3° for Saturn.
  - The Moon is a low-precision series, accurate to about 0.3°.
  - Both are replaced by DE440-fitted Chebyshev series in milestone 2. The time slider is limited to 1000–3000 AD.
- **Sun position.** The Sun sits at the root frame's origin. The solar-system barycentre offset, under 0.01 AU, arrives with DE440.
- **Distance limits.**
  - Zoom stops at about 300 pc. Galaxies and large-scale structure come in milestone 3.
  - 10,225 stars have no usable parallax. They are placed at 1 kpc in their true direction, with their apparent magnitude preserved, and are flagged in the data.
- **Not yet built.** Atmospheric scattering, ring shadows on planets, night-side Earth lighting from the Moon, and sky view.
- **Bundle size.** The JS bundle is about 230 kB gzipped and not yet code-split. That is planned for milestone 6.

## Roadmap

1. ✅ Scaffold, floating-origin renderer, starfield, solar system
2. Ephemerides (DE440 Chebyshev, ELP), Sky view, satellites (SGP4), rise/set
3. Zoom-out: Gaia tiles, nebulae, Milky Way, Local Group, cosmic web
4. Free flight, warp-to, command palette, shareable URLs
5. Explore/catalogue tab with facts and "where to find it"
6. Polish, performance, PWA/offline, themes, full documentation
