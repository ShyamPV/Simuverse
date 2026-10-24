/**
 * Owns the WebGL renderer, the frame graph, both camera rigs and all layers,
 * and runs the render loop. The UI talks to it through this class only.
 *
 * Two view modes share one scene:
 *  - Universe: orbit camera around a focused body (milestone 1).
 *  - Sky: the observer standing on Earth, with horizon, atmosphere, apparent
 *    positions, constellations and satellites. Zooming out past the widest
 *    field of view lifts off into Universe mode.
 */

import {
  AU, C_KM_PER_DAY, DEG, Ephemeris, type GeodeticLocation, LY, PC, type Satellite, type SolarBodyId, type Target,
  type Tle, type Vec3, type AstroTime, SOLAR_SYSTEM, apparentBody, apparentFixed, apparentFromVector,
  apparentMagnitude, bodyPhotometry, createSatellite, mulMat3Vec, observerState, satelliteItrs,
} from '@simuverse/astro';
import {
  type Constellations, EphemerisLoader, type StarNameEntry, type TleResult, constellationAt, loadConstellations,
  loadStarCatalog, loadStarNames, loadTles, starDisplayName,
} from '@simuverse/data';
import {
  ACESFilmicToneMapping, DepthTexture, FloatType, HalfFloatType, PerspectiveCamera, Quaternion, Scene, Vector2,
  Vector3, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { CameraRig } from './CameraRig.ts';
import { DeepSpace, type DeepQuality, type DeepSpaceStats } from './DeepSpace.ts';
import { FrameGraph } from './frames.ts';
import { type LabelItem, LabelLayer } from './LabelLayer.ts';
import { AtmosphereLayer } from './layers/AtmosphereLayer.ts';
import { ConstellationLayer } from './layers/ConstellationLayer.ts';
import { GroundLayer } from './layers/GroundLayer.ts';
import { SatelliteLayer } from './layers/SatelliteLayer.ts';
import { SolarSystemLayer } from './layers/SolarSystemLayer.ts';
import { StarLayer } from './layers/StarLayer.ts';
import type { RenderContext, SkyContext, ViewMode } from './layers/types.ts';
import { OrbitCameraRig, type OrbitTarget } from './OrbitCameraRig.ts';
import { exposureFor, galaxyMagRef, ladderStep, sceneFogMpc } from './scale.ts';
import { SkyCameraRig } from './SkyCameraRig.ts';
import { SkyEvents, type SkyEventsResponse } from './SkyEvents.ts';
import { limitingMagnitude } from './skyBrightness.ts';
import { SUN_FRAME_ID, SolarSystemModel } from './SolarSystemModel.ts';
import { TimeController } from './TimeController.ts';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type DepthMode = 'reversed-z' | 'logarithmic';
export type { ViewMode };

const QUALITY: Record<QualityPreset, { maxPixelRatio: number; msaa: number; bloom: boolean } & DeepQuality> = {
  low: { maxPixelRatio: 1, msaa: 0, bloom: false, volumeSteps: 32, volumeScale: 0.5, starBudget: 400_000, webBudget: 100_000 },
  medium: { maxPixelRatio: 1.5, msaa: 2, bloom: true, volumeSteps: 48, volumeScale: 0.5, starBudget: 800_000, webBudget: 200_000 },
  high: { maxPixelRatio: 2, msaa: 4, bloom: true, volumeSteps: 72, volumeScale: 0.5, starBudget: 1_500_000, webBudget: 400_000 },
  ultra: { maxPixelRatio: 3, msaa: 8, bloom: true, volumeSteps: 112, volumeScale: 0.75, starBudget: 2_500_000, webBudget: 600_000 },
};

const STAR_MAG_REF = 5.5;
/** Limiting magnitude when not looking through an atmosphere. */
const SPACE_MAG_LIMIT = 8.5;
const STAR_LABEL_MAG = 1.6;
const MAX_STAR_LABELS = 24;
const STAR_LABEL_CANDIDATES = 600;
/** Beyond the observable universe's comoving radius (4.4e26 m). */
const FAR_PLANE = 1e28;
const PC_KM = PC / 1000;
/** Satellites that get a permanent label when visible. */
const LABELLED_SATELLITES = new Set([25544, 48274, 20580]);
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
/** Names of the orbit centres that aren't objects in their own right. */
const FOCUS_NAMES: Record<string, string> = {
  galaxy: 'Milky Way', 'local-group': 'Local Group', virgo: 'Virgo Cluster', laniakea: 'Laniakea', universe: 'Observable universe',
};

export type ZoomLevel =
  | 'sky' | 'planet' | 'solar-system' | 'milky-way' | 'local-group' | 'virgo' | 'laniakea' | 'universe';

export interface ObserverLocation {
  name: string;
  latDeg: number;
  lonDeg: number;
  /** Metres above sea level. */
  elevation: number;
  /** IANA time zone, if known (for displaying local times). */
  tz?: string;
}

export interface SkyOptions {
  figures: boolean;
  names: boolean;
  bounds: boolean;
  ground: boolean;
  atmosphere: boolean;
  satellites: boolean;
  /** Naked-eye limiting magnitude under a dark sky (light pollution). */
  darkSkyLimit: number;
}

export const DEFAULT_SKY_OPTIONS: SkyOptions = {
  figures: true, names: true, bounds: false, ground: true, atmosphere: true, satellites: true, darkSkyLimit: 6.5,
};

export type SelectionKind = 'star' | 'planet' | 'moon' | 'dwarf-planet' | 'satellite' | 'galaxy' | 'nebula' | 'cluster';

export interface SelectionInfo {
  /** 'body:<id>', 'star:<index>', 'sat:<norad>', 'gal:<i>', 'dso:<i>' or 'tyc:<id>'. */
  key: string;
  kind: SelectionKind;
  name: string;
  /** Type line shown above the name (e.g. "Planetary nebula"); defaults to the kind. */
  subtitle?: string;
  /** Whether the camera can travel to it in Universe view. */
  travelable: boolean;
  /** Secondary facts: designations, spectral type, NORAD id, phase… */
  details: [string, string][];
  constellation?: string;
  /** Astrometric J2000 and apparent-of-date coordinates, radians. */
  raJ2000: number;
  decJ2000: number;
  ra: number;
  dec: number;
  /** Altitude with refraction, and azimuth (from north, eastward), radians. */
  alt: number;
  az: number;
  /** Observer → object, metres; undefined if unknown. */
  distance?: number;
  magnitude?: number;
  /** True for positions from fallback models or placeholder data. */
  approximate: boolean;
  /** For rise/set requests. */
  target?: Target;
  tle?: Tle;
}

export interface EngineStats {
  mode: ViewMode;
  fps: number;
  frameMs: number;
  fovDeg: number;
  focusId: string;
  focusName: string;
  /** Camera → focus centre, metres (Universe mode). */
  distance: number;
  /** Camera height above the focus surface, metres. */
  altitude: number;
  /** Camera speed relative to the focus, m/s. */
  speed: number;
  /** Metres per CSS pixel at the focus distance (for the scale bar). */
  metresPerPixel: number;
  /** Camera → Sun distance, metres. */
  distanceFromSun: number;
  /** Focused body's distance from the Sun and from Earth's centre, metres. */
  focusFromSun: number;
  focusFromEarth: number;
  simTimeMs: number;
  rate: number;
  paused: boolean;
  depthMode: DepthMode;
  starsLoaded: boolean;
  /** DE440 data covers the current date (otherwise fallback models). */
  precise: boolean;
  observer: ObserverLocation;
  /** Sun altitude at the observer, degrees (Sky mode). */
  sunAltDeg: number | null;
  /** Centre of view in horizontal coordinates, radians (Sky mode). */
  view: { az: number; alt: number } | null;
  selection: SelectionInfo | null;
  satellites: { count: number; source: TleResult['source']; fetchedAt: number } | null;
  deep: DeepSpaceStats;
  /** Magnitudes added to point-source photometry by auto-exposure (0 near the Sun). */
  exposureMag: number;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** Element overlaying the canvas for DOM labels. */
  overlay: HTMLElement;
  dataBaseUrl: string;
  textureBaseUrl: string;
  quality?: QualityPreset;
  reducedMotion?: boolean;
  observer?: ObserverLocation;
  mode?: ViewMode;
  skyOptions?: Partial<SkyOptions>;
}

/** True if this browser exposes EXT_clip_control (needed for reversed-Z). */
function supportsReversedZ(): boolean {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return false;
  const ok = !!gl.getExtension('EXT_clip_control');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return ok;
}

const toGeodetic = (o: ObserverLocation): GeodeticLocation => ({ lat: o.latDeg * DEG, lon: o.lonDeg * DEG, height: o.elevation });

export class Engine {
  readonly time = new TimeController();
  readonly frames = new FrameGraph('ssb');
  readonly loader: EphemerisLoader;
  readonly ephemeris: Ephemeris;
  readonly solar: SolarSystemModel;
  readonly orbitRig: OrbitCameraRig;
  readonly skyRig: SkyCameraRig;
  readonly depthMode: DepthMode;
  private readonly events: SkyEvents;

  private mode: ViewMode;
  private observer: ObserverLocation;
  private geodetic: GeodeticLocation;
  private skyOptions: SkyOptions;
  private selection: string | null = null;
  private skyCtx: SkyContext | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(50, 1, 1, FAR_PLANE);
  private composer!: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private readonly solarLayer: SolarSystemLayer;
  private readonly atmosphere = new AtmosphereLayer();
  private readonly ground = new GroundLayer();
  private starLayer: StarLayer | null = null;
  private constellationLayer: ConstellationLayer | null = null;
  private constellationData: Constellations | null = null;
  private satelliteLayer: SatelliteLayer | null = null;
  private tleInfo: EngineStats['satellites'] = null;
  private starNames = new Map<number, StarNameEntry>();
  private starLabelNames: StarNameEntry[] = [];
  private readonly deep: DeepSpace;
  private readonly labels: LabelLayer;
  private showLabels = true;
  private magLimit = SPACE_MAG_LIMIT;
  private magRef = STAR_MAG_REF;
  /** Direction of the most recent zoom input (drives the scale ladder). */
  private zoomingOut = true;

  private quality: QualityPreset;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private raf = 0;
  private lastFrame = performance.now();
  private readonly resizeObserver: ResizeObserver;
  private readonly statsListeners = new Set<(s: EngineStats) => void>();
  private readonly modeListeners = new Set<(m: ViewMode) => void>();
  private lastStatsEmit = 0;
  private fpsFrames = 0;
  private fpsStart = performance.now();
  private fps = 0;
  private frameMs = 0;
  private speed = 0;
  private readonly prevOffset: Vec3 = [0, 0, 0];
  private ephemerisRequest: Promise<unknown> | null = null;
  private disposed = false;

  private readonly scratch: Vec3 = [0, 0, 0];
  private readonly v3 = new Vector3();
  private readonly invCam = new Quaternion();
  private readonly ctx: RenderContext;
  private readonly detach: () => void;

  constructor(private readonly opts: EngineOptions) {
    this.quality = opts.quality ?? 'high';
    this.depthMode = supportsReversedZ() ? 'reversed-z' : 'logarithmic';
    this.renderer = new WebGLRenderer({
      canvas: opts.canvas,
      antialias: false, // MSAA happens on the HDR target instead
      powerPreference: 'high-performance',
      reversedDepthBuffer: this.depthMode === 'reversed-z',
      logarithmicDepthBuffer: this.depthMode === 'logarithmic',
      preserveDrawingBuffer: true, // screenshots
    });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, 1);

    const ephemBase = new URL('ephem/', new URL(opts.dataBaseUrl, location.href)).href;
    this.loader = new EphemerisLoader(ephemBase);
    this.ephemeris = new Ephemeris(this.loader.store);
    this.events = new SkyEvents(ephemBase);
    this.solar = new SolarSystemModel(this.frames, this.ephemeris);
    this.observer = opts.observer ?? { name: 'Greenwich', latDeg: 51.4769, lonDeg: -0.0005, elevation: 46, tz: 'Europe/London' };
    this.geodetic = toGeodetic(this.observer);
    this.skyOptions = { ...DEFAULT_SKY_OPTIONS, ...opts.skyOptions };
    this.mode = opts.mode ?? 'sky';

    const t0 = this.time.now();
    this.frames.update(t0);
    this.solar.update(t0);
    void this.requestEphemeris(t0.jdTdb);

    const earth = this.targetFor('earth')!;
    this.orbitRig = new OrbitCameraRig(this.frames, earth, earth.radius * 3.2, opts.reducedMotion);
    this.pointAtSunlitSide(earth);
    this.skyRig = new SkyCameraRig(earth.frame, this.geodetic, opts.reducedMotion, () => this.liftOff());

    this.solarLayer = new SolarSystemLayer(this.solar, opts.textureBaseUrl, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.solarLayer.object, this.ground.object, this.atmosphere.object);
    this.deep = new DeepSpace(this.scene, this.frames, this.frames.require(SUN_FRAME_ID), new URL(opts.dataBaseUrl, location.href).href);
    this.deep.setQuality(QUALITY[this.quality]);

    this.labels = new LabelLayer(opts.overlay, (key) => this.activateLabel(key));

    this.ctx = {
      time: t0,
      frames: this.frames,
      ephemeris: this.ephemeris,
      rig: this.rig,
      mode: this.mode,
      sky: null,
      camera: this.camera,
      exposure: { pointMag: 0, extendedGain: 1, fogMpc: 1e9 },
      width: 1,
      height: 1,
      pixelRatio: 1,
      pixelsPerRadian: 1,
      toCamera: (frame, local, out) => this.frames.difference(this.rig.anchor, this.rig.offset, frame, local, out),
    };

    this.buildComposer();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(opts.canvas.parentElement ?? opts.canvas);
    this.resize();
    const offTime = this.time.onChange(() => this.emitStats(this.time.now()));
    const offEphem = this.loader.onLoad(() => this.emitStats(this.time.now()));
    const offInput = this.attachInput();
    this.detach = () => {
      offTime();
      offEphem();
      offInput();
    };
    this.loadCatalogues();
    if (this.mode === 'sky') this.prepareSkyView(true);
    this.raf = requestAnimationFrame(this.frame);
  }

  private get rig(): CameraRig {
    return this.mode === 'sky' ? this.skyRig : this.orbitRig;
  }

  // ---------------------------------------------------------------- public API

  onStats(cb: (s: EngineStats) => void): () => void {
    this.statsListeners.add(cb);
    return () => this.statsListeners.delete(cb);
  }

  onModeChange(cb: (m: ViewMode) => void): () => void {
    this.modeListeners.add(cb);
    return () => this.modeListeners.delete(cb);
  }

  get viewMode(): ViewMode {
    return this.mode;
  }

  get location(): ObserverLocation {
    return this.observer;
  }

  setObserver(o: ObserverLocation): void {
    this.observer = o;
    this.geodetic = toGeodetic(o);
    this.skyRig.setLocation(this.geodetic);
    this.emitStats(this.time.now());
  }

  setSkyOptions(patch: Partial<SkyOptions>): void {
    this.skyOptions = { ...this.skyOptions, ...patch };
    if (this.constellationLayer) {
      this.constellationLayer.showFigures = this.skyOptions.figures;
      this.constellationLayer.showBounds = this.skyOptions.bounds;
    }
    if (this.satelliteLayer) this.satelliteLayer.enabled = this.skyOptions.satellites;
  }

  /** Switch to Sky view (standing at the observer location). */
  enterSky(): void {
    if (this.mode === 'sky') return;
    this.setMode('sky');
    this.prepareSkyView(false);
  }

  /**
   * Focus a solar-system body ('jupiter') or a deep object ('gal:12', 'dso:4').
   * In Universe mode the camera travels to it; in Sky mode it is selected and
   * the view turns to it.
   */
  focus(id: string): void {
    const deep = id.includes(':');
    if (deep ? !this.deep.target(id) && this.mode === 'universe' : !this.solar.get(id)) return;
    // Earth can't be 'seen' by an observer standing on it; focusing it just clears the selection.
    this.selection = id === 'earth' ? null : deep ? id : `body:${id}`;
    if (this.mode === 'sky') {
      this.centerOnSelection();
    } else {
      const target = this.targetFor(id)!;
      const viewDistance = deep ? this.deep.viewDistance(id) : target.radius * (id === 'sun' || id === 'saturn' ? 6 : 3.2);
      this.orbitRig.focus(target, viewDistance);
    }
    this.emitStats(this.ctx.time);
  }

  select(key: string | null): void {
    this.selection = key;
    this.emitStats(this.ctx.time);
  }

  /** Turns the Sky view to the selection, or travels to it in Universe mode. */
  centerOnSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    if (this.mode === 'universe') {
      if (sel.startsWith('body:')) this.focus(sel.slice(5));
      else if (sel.startsWith('gal:') || sel.startsWith('dso:')) this.focus(sel);
      return;
    }
    const dir = this.selectionDirection(sel);
    if (!dir) return;
    this.skyRig.place(this.solar.earth);
    const { az, alt } = this.skyRig.horizontalOf(dir);
    this.skyRig.lookAt(az, alt);
  }

  zoomToLevel(level: ZoomLevel): void {
    if (level === 'sky') {
      this.enterSky();
      return;
    }
    if (this.mode === 'sky') this.liftOff();
    if (level === 'planet') {
      this.focus('earth');
      return;
    }
    if (level === 'solar-system') {
      if (this.orbitRig.target.id !== 'sun') this.focus('sun');
      this.orbitRig.zoomToDistance(70 * AU);
      return;
    }
    const id = { 'milky-way': 'galaxy', 'local-group': 'local-group', virgo: 'virgo', laniakea: 'laniakea', universe: 'universe' }[level];
    const target = this.deep.target(id);
    if (!target) return;
    this.orbitRig.takeOver(target, this.orbitRig.anchor, [...this.orbitRig.offset], this.orbitRig.quaternion, this.deep.viewDistance(id), 'exact');
    const dir = this.deep.preferredViewDirection(id);
    if (dir) this.orbitRig.viewFrom(dir);
    this.emitStats(this.ctx.time);
  }

  setQuality(q: QualityPreset): void {
    if (q === this.quality) return;
    this.quality = q;
    this.deep.setQuality(QUALITY[q]);
    this.buildComposer();
    this.resize();
  }

  /** Toggles for the deep-sky layers (galaxies + cosmic web, nebulae/clusters, Milky Way). */
  setDeepSkyOptions(o: { galaxies?: boolean; deepSky?: boolean; milkyWay?: boolean }): void {
    if (o.galaxies !== undefined) this.deep.showGalaxies = o.galaxies;
    if (o.deepSky !== undefined) this.deep.showDeepSky = o.deepSky;
    if (o.milkyWay !== undefined) this.deep.showMilkyWay = o.milkyWay;
  }

  setReducedMotion(v: boolean): void {
    this.orbitRig.setReducedMotion(v);
    this.skyRig.setReducedMotion(v);
  }

  setLabelsVisible(v: boolean): void {
    this.showLabels = v;
  }

  setOrbitsVisible(v: boolean): void {
    this.solarLayer.setOrbitsVisible(v);
  }

  /** Rise/set/transit, twilight, Moon phase and satellite passes, computed off the main thread. */
  computeSkyEvents(
    startMs: number, targets: { key: string; target: Target }[], includeTwilight = false,
    satellites: { key: string; tle: Tle }[] = [], passHours = 24,
  ): Promise<SkyEventsResponse> {
    return this.events.compute(this.geodetic, startMs, targets, includeTwilight, satellites, passHours);
  }

  /** Element set of a loaded satellite, by NORAD id. */
  satelliteTle(noradId: number): Tle | undefined {
    return this.satelliteLayer?.satellites.find((s) => s.noradId === noradId)?.tle;
  }

  /** PNG data URL of the current frame. */
  screenshot(): string {
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.detach();
    this.events.dispose();
    this.labels.dispose();
    this.solarLayer.dispose();
    this.starLayer?.dispose();
    this.constellationLayer?.dispose();
    this.satelliteLayer?.dispose();
    this.atmosphere.dispose();
    this.ground.dispose();
    this.deep.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- setup

  private targetFor(id: string): OrbitTarget | undefined {
    const b = this.solar.get(id);
    return b ? { id, frame: b.frame, radius: b.info.radius } : this.deep.target(id);
  }

  /** Starts the orbit camera between the Sun direction and the terminator, so it opens on daylight. */
  private pointAtSunlitSide(target: OrbitTarget): void {
    const toSun = this.frames.difference(target.frame, [0, 0, 0], this.frames.require(SUN_FRAME_ID), [0, 0, 0]);
    this.orbitRig.setAngles(Math.atan2(toSun[1], toSun[0]) + 0.75, 0.32);
  }

  private setMode(m: ViewMode): void {
    this.mode = m;
    this.ctx.rig = this.rig;
    this.ctx.mode = m;
    for (const cb of this.modeListeners) cb(m);
    this.emitStats(this.time.now());
  }

  /** Leaves Sky view upward, continuing from the observer's exact viewpoint. */
  private liftOff(): void {
    if (this.mode !== 'sky') return;
    const earth = this.targetFor('earth')!;
    this.orbitRig.takeOver(earth, this.skyRig.anchor, [...this.skyRig.offset], this.skyRig.quaternion, earth.radius * 3.2, 'exact');
    this.setMode('universe');
  }

  /**
   * On entering Sky view, face something worth seeing: the Moon or the
   * brightest planet if well above the horizon, otherwise the equator-facing
   * horizon (south in the northern hemisphere).
   */
  private prepareSkyView(instant: boolean): void {
    const t = this.time.now();
    this.solar.update(t);
    this.skyRig.place(this.solar.earth);
    const obs = observerState(this.ephemeris, t, this.geodetic);
    let best: { az: number; alt: number; mag: number } | null = null;
    for (const id of ['moon', 'venus', 'jupiter', 'mars', 'saturn', 'mercury'] as SolarBodyId[]) {
      const p = apparentBody(this.ephemeris, obs, id);
      const mag = bodyPhotometry(this.ephemeris, obs, id).magnitude;
      if (p.horizontal.alt > 12 * DEG && (!best || mag < best.mag)) best = { az: p.horizontal.az, alt: p.horizontal.alt, mag };
    }
    if (best) this.skyRig.lookAt(best.az, Math.min(best.alt, 60 * DEG), instant);
    else this.skyRig.lookAt(this.geodetic.lat >= 0 ? Math.PI : 0, 25 * DEG, instant);
    this.skyRig.setFov(70);
  }

  private requestEphemeris(jdTdb: number): Promise<unknown> | null {
    if (this.ephemerisRequest) return this.ephemerisRequest;
    this.ephemerisRequest = this.loader
      .ensure(jdTdb)
      .catch((err) => console.warn('Ephemeris chunk failed to load; using fallback models', err))
      .finally(() => {
        this.ephemerisRequest = null;
      });
    return this.ephemerisRequest;
  }

  private loadCatalogues(): void {
    const base = this.opts.dataBaseUrl;
    Promise.all([loadStarCatalog(base), loadStarNames(base)])
      .then(([stars, names]) => {
        if (this.disposed) return;
        this.starNames = new Map(names.map((n) => [n.i, n]));
        this.starLabelNames = names.filter((n) => n.i < STAR_LABEL_CANDIDATES && starDisplayName(n));
        this.starLayer = new StarLayer(stars, this.frames.require(SUN_FRAME_ID), { magRef: this.magRef, magLimit: this.magLimit });
        this.scene.add(this.starLayer.object);
      })
      .catch((err) => console.error('Star catalogue failed to load', err));

    loadConstellations(new URL(base, location.href).href)
      .then((data) => {
        if (this.disposed) return;
        this.constellationData = data;
        this.constellationLayer = new ConstellationLayer(data);
        this.constellationLayer.showFigures = this.skyOptions.figures;
        this.constellationLayer.showBounds = this.skyOptions.bounds;
        this.scene.add(this.constellationLayer.object);
      })
      .catch((err) => console.error('Constellations failed to load', err));

    loadTles(new URL('tle-snapshot.txt', new URL(base, location.href)).href)
      .then((res) => {
        if (this.disposed) return;
        const sats = res.tles.map(createSatellite).filter((s): s is Satellite => s !== null);
        this.satelliteLayer = new SatelliteLayer(sats, this.solar);
        this.satelliteLayer.enabled = this.skyOptions.satellites;
        this.satelliteLayer.setPhotometry(this.magRef, this.magLimit);
        this.scene.add(this.satelliteLayer.object);
        this.tleInfo = { count: sats.length, source: res.source, fetchedAt: res.fetchedAt };
      })
      .catch((err) => console.error('Satellite elements failed to load', err));
  }

  private buildComposer(): void {
    this.composer?.dispose();
    const q = QUALITY[this.quality];
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: q.msaa });
    if (this.depthMode === 'reversed-z') {
      // Reversed-Z only pays off with a float depth buffer.
      target.depthTexture = new DepthTexture(1, 1, FloatType);
    }
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = q.bloom ? new UnrealBloomPass(new Vector2(1, 1), 0.4, 0.2, 1.0) : null;
    if (this.bloom) this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  private resize(): void {
    const el = this.opts.canvas.parentElement ?? this.opts.canvas;
    this.width = Math.max(1, el.clientWidth);
    this.height = Math.max(1, el.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- input

  private attachInput(): () => void {
    const canvas = this.opts.canvas;
    let drag: { x: number; y: number; moved: number; id: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.mode === 'sky') {
        // Grab-the-sky: the point under the cursor follows it at any zoom.
        const radPerPx = (this.skyRig.fovDeg * DEG) / this.height;
        this.skyRig.panBy(-dx * radPerPx, dy * radPerPx);
      } else this.orbitRig.rotateBy(-dx * 0.005, dy * 0.005);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved < 4) this.pick(e.clientX, e.clientY);
      drag = null;
    };
    const onDouble = () => this.centerOnSelection();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const amount = e.deltaY * scale * 0.0015;
      this.zoomingOut = amount > 0;
      if (this.mode === 'sky') this.skyRig.zoomBy(amount * 0.8);
      else this.orbitRig.zoomBy(amount);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const step = e.shiftKey ? 0.2 : 0.06;
      const sky = this.mode === 'sky';
      const turn = (dAz: number, dEl: number) => {
        if (sky) this.skyRig.panBy(dAz * this.skyRig.fovDeg * DEG * 0.5, dEl * this.skyRig.fovDeg * DEG * 0.5);
        else this.orbitRig.rotateBy(dAz, dEl);
      };
      const zoom = (a: number) => {
        this.zoomingOut = a > 0;
        if (sky) this.skyRig.zoomBy(a);
        else this.orbitRig.zoomBy(a);
      };
      switch (e.key) {
        case 'ArrowLeft': turn(sky ? -step : step, 0); break;
        case 'ArrowRight': turn(sky ? step : -step, 0); break;
        case 'ArrowUp': turn(0, step); break;
        case 'ArrowDown': turn(0, -step); break;
        case '+': case '=': case 'PageUp': zoom(-0.35); break;
        case '-': case '_': case 'PageDown': zoom(0.35); break;
        default: return;
      }
      e.preventDefault();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDouble);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', onDouble);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }

  private activateLabel(key: string): void {
    if (key.startsWith('body:') && this.mode === 'universe') this.focus(key.slice(5));
    else if (key.startsWith('con:') || key.startsWith('card:')) return;
    else this.select(key);
  }

  /**
   * Selects whatever is under (or near) a click: bodies and satellites within
   * a few pixels, otherwise the brightest catalogue star within reach.
   * In Universe mode, clicking a body also travels to it.
   */
  private pick(clientX: number, clientY: number): void {
    const rect = this.opts.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    let best: { key: string; score: number } | null = null;
    const consider = (key: string, rel: Readonly<Vec3>, reachPx: number, bias = 0) => {
      const s = this.project(rel);
      if (!s) return;
      const d = Math.hypot(s[0] - x, s[1] - y);
      if (d > reachPx) return;
      const score = d / reachPx + bias;
      if (!best || score < best.score) best = { key, score };
    };
    for (const v of this.solarLayer.views) {
      if (v.shown && !this.belowHorizon(v.rel)) consider(`body:${v.id}`, v.rel, Math.max(v.radiusPx, 12));
    }
    for (const v of this.satelliteLayer?.views ?? []) if (v.visible) consider(`sat:${v.id}`, v.rel, 10);
    if (!best) {
      this.deep.pick((key, rel, reach, bias) => {
        if (!this.belowHorizon(rel)) consider(key, rel, reach, bias);
      }, this.ctx.pixelsPerRadian, this.magLimit);
    }
    if (!best && this.starLayer) {
      const pos = this.starLayer.stars.positions, absMag = this.starLayer.stars.absMag;
      const cam = this.cameraPc();
      const rel: Vec3 = [0, 0, 0];
      for (let i = 0; i < this.starLayer.stars.count; i++) {
        rel[0] = pos[i * 3]! - cam[0];
        rel[1] = pos[i * 3 + 1]! - cam[1];
        rel[2] = pos[i * 3 + 2]! - cam[2];
        const mag = apparentMagnitude(absMag[i]!, Math.hypot(rel[0], rel[1], rel[2]));
        if (mag > this.magLimit) continue;
        if (this.belowHorizon(rel)) continue;
        // Prefer brighter stars among those near the click.
        consider(`star:${i}`, rel, 10, mag * 0.05);
      }
    }
    if (!best) {
      this.deep.pickStars((key, rel, reach, bias) => {
        if (!this.belowHorizon(rel)) consider(key, rel, reach, bias);
      }, this.cameraPc(), this.magLimit);
    }
    const picked = best as { key: string } | null;
    if (!picked) {
      this.select(null);
      return;
    }
    if (picked.key.startsWith('body:') && this.mode === 'universe') {
      const id = picked.key.slice(5);
      if (id !== this.orbitRig.target.id) this.focus(id);
      else this.select(picked.key);
    } else this.select(picked.key);
  }

  // ---------------------------------------------------------------- frame loop

  /** Camera position relative to the Sun, parsecs. */
  private cameraPc(): Vec3 {
    const s = this.ctx.toCamera(this.frames.require(SUN_FRAME_ID), [0, 0, 0], [0, 0, 0]);
    return [-s[0] / PC, -s[1] / PC, -s[2] / PC];
  }

  private belowHorizon(rel: Readonly<Vec3>): boolean {
    return !!this.skyCtx?.ground && this.skyRig.horizontalOf(rel).alt < 0;
  }

  /** Camera-relative vector → CSS pixel position, or null if behind the camera / off screen. */
  private project(rel: Readonly<Vec3>, margin = 1.05): [number, number] | null {
    const len = Math.hypot(rel[0], rel[1], rel[2]) || 1;
    // Normalise first: projection only needs the direction, and this keeps
    // the math well-conditioned for objects light-years away.
    const v = this.v3.set(rel[0] / len, rel[1] / len, rel[2] / len).applyQuaternion(this.invCam);
    if (v.z >= -1e-6) return null;
    const p = this.camera.projectionMatrix.elements;
    const sx = (p[0]! * v.x) / -v.z;
    const sy = (p[5]! * v.y) / -v.z;
    if (Math.abs(sx) > margin || Math.abs(sy) > margin) return null;
    return [(sx * 0.5 + 0.5) * this.width, (0.5 - sy * 0.5) * this.height];
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    const t: AstroTime = this.time.now();
    if (!this.ephemeris.isPrecise(t.jdTdb)) void this.requestEphemeris(t.jdTdb);
    this.frames.update(t);
    this.solar.update(t);
    this.skyCtx = this.mode === 'sky' ? this.buildSkyContext(t) : null;

    const prevAnchor = this.rig.anchor;
    this.prevOffset[0] = this.rig.offset[0];
    this.prevOffset[1] = this.rig.offset[1];
    this.prevOffset[2] = this.rig.offset[2];
    this.rig.update(dt);
    if (this.mode === 'universe') {
      // Scale ladder: hand the orbit centre outward (Sun → Galaxy → Local Group → universe) and back.
      const id = this.orbitRig.target.id;
      const next = ladderStep(id, this.orbitRig.distance, this.zoomingOut, !!this.solar.get(id));
      const target = next ? this.targetFor(next) : undefined;
      if (target) this.orbitRig.retarget(target);
    }
    if (this.mode === 'universe' && prevAnchor === this.rig.anchor && dt > 0) {
      const o = this.rig.offset;
      const inst = Math.hypot(o[0] - this.prevOffset[0], o[1] - this.prevOffset[1], o[2] - this.prevOffset[2]) / dt;
      this.speed += (inst - this.speed) * Math.min(1, dt * 8);
    } else if (this.mode === 'sky') this.speed = 0;

    this.camera.quaternion.copy(this.rig.quaternion);
    this.camera.fov = this.rig.fovDeg;
    // Near plane tracks altitude; float/reversed or log depth keeps the far plane cheap.
    this.camera.near = this.mode === 'sky' ? 0.5 : Math.min(Math.max(this.rig.altitude * 0.01, 0.5), 1e7);
    this.camera.far = FAR_PLANE;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.invCam.copy(this.camera.quaternion).invert();

    const ctx = this.ctx;
    ctx.time = t;
    ctx.sky = this.skyCtx;
    ctx.width = this.width;
    ctx.height = this.height;
    ctx.pixelRatio = this.pixelRatio;
    ctx.pixelsPerRadian = this.height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);

    // Auto-exposure: nothing changes near home; far away, point sources are boosted.
    const sunRel = ctx.toCamera(this.frames.require(SUN_FRAME_ID), [0, 0, 0], this.scratch);
    const exposure = this.skyCtx
      ? { pointMag: 0, extendedGain: 1, fogMpc: 1e9 }
      : { ...exposureFor(Math.hypot(sunRel[0], sunRel[1], sunRel[2])), fogMpc: sceneFogMpc(this.orbitRig.focusDistance) };
    ctx.exposure = exposure;
    this.applyPhotometry(
      STAR_MAG_REF + exposure.pointMag,
      (this.skyCtx ? this.skyCtx.limitMag : SPACE_MAG_LIMIT) + exposure.pointMag,
    );
    // Galaxies: naked-eye photometry on the ground, scale-referenced in space.
    const galRef = this.skyCtx ? STAR_MAG_REF : galaxyMagRef(this.orbitRig.focusDistance, STAR_MAG_REF);
    this.deep.setGalaxyPhotometry(galRef, this.skyCtx ? this.skyCtx.limitMag : galRef + 2.5);
    this.solarLayer.update(ctx);
    this.starLayer?.update(ctx);
    if (this.starLayer) this.deep.attachStarTemplate(this.starLayer);
    // Faint deep-sky light disappears into a bright sky.
    const skyVisibility = this.skyCtx ? smoothstep(2, 5.5, this.skyCtx.limitMag) : 1;
    this.deep.update(ctx, skyVisibility);
    this.constellationLayer?.update(ctx);
    this.satelliteLayer?.update(ctx);
    this.ground.update(ctx);
    this.atmosphere.update(ctx);
    this.atmosphere.renderLut(this.renderer);
    this.deep.renderVolumes(this.renderer, this.camera);
    this.composer.render(dt);
    this.labels.render(this.collectLabels());

    this.trackPerformance(now);
    if (now - this.lastStatsEmit > 200) {
      this.lastStatsEmit = now;
      this.emitStats(t);
    }
  };

  private buildSkyContext(t: AstroTime): SkyContext {
    this.skyRig.place(this.solar.earth);
    const observer = observerState(this.ephemeris, t, this.geodetic);
    const sun = apparentBody(this.ephemeris, observer, 'sun').direction;
    const { east, north, up } = this.skyRig.basis;
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const sunLocal: Vec3 = [dot(sun, east), dot(sun, north), dot(sun, up)];
    const sunAlt = Math.asin(Math.max(-1, Math.min(1, sunLocal[2])));
    const o = this.skyOptions;
    const k = 1 / C_KM_PER_DAY;
    return {
      rig: this.skyRig,
      observer,
      velocityC: [observer.velocity[0] * k, observer.velocity[1] * k, observer.velocity[2] * k],
      sunAlt,
      sunLocal,
      limitMag: o.atmosphere ? limitingMagnitude(sunAlt / DEG, o.darkSkyLimit) : o.darkSkyLimit,
      ground: o.ground,
      atmosphere: o.atmosphere,
    };
  }

  private applyPhotometry(magRef: number, limit: number): void {
    if (Math.abs(limit - this.magLimit) < 0.01 && Math.abs(magRef - this.magRef) < 0.01) return;
    this.magLimit = limit;
    this.magRef = magRef;
    this.starLayer?.setPhotometry({ magRef, magLimit: limit });
    this.solarLayer.setPhotometry(magRef, limit);
    this.satelliteLayer?.setPhotometry(magRef, limit);
    this.deep.setStarPhotometry(limit);
  }

  private collectLabels(): LabelItem[] {
    const items: LabelItem[] = [];
    const placed: [number, number][] = [];
    const free = (x: number, y: number) => placed.every(([px, py]) => Math.abs(px - x) > 70 || Math.abs(py - y) > 14);
    const sky = this.mode === 'sky';

    // Selection reticle first, regardless of label visibility settings.
    const selRel = this.selection ? this.selectionRel(this.selection) : null;
    if (selRel) {
      const s = this.project(selRel);
      if (s) {
        const body = this.selection!.startsWith('body:') ? this.solarLayer.getView(this.selection!.slice(5)) : undefined;
        items.push({ key: 'reticle', text: '', kind: 'reticle', x: s[0], y: s[1], marker: false, offset: Math.max(body?.radiusPx ?? 0, 7) + 4 });
      }
    }
    if (!this.showLabels) return items;

    const focusId = sky ? (this.selection?.startsWith('body:') ? this.selection.slice(5) : '') : this.orbitRig.target.id;
    const views = this.solarLayer.views.filter((v) => v.shown);
    // Focus first, then by apparent size and brightness (bigger/brighter wins collisions).
    views.sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : b.radiusPx - a.radiusPx || a.magnitude - b.magnitude));
    for (const v of views) {
      if (v.radiusPx > Math.min(this.width, this.height) * 0.35) continue;
      if (sky && (this.belowHorizon(v.rel) || (v.magnitude > this.magLimit + 1 && v.id !== focusId))) continue;
      const s = this.project(v.rel);
      if (!s || this.occluded(v.rel, v.distance, v.id)) continue;
      if (v.id !== focusId && !free(s[0], s[1])) continue;
      placed.push(s);
      items.push({
        key: `body:${v.id}`, text: v.name, kind: 'body', x: s[0], y: s[1],
        marker: !sky && v.radiusPx < 2.5, offset: Math.max(v.radiusPx, 3) + 6,
        color: this.solar.get(v.id)!.info.color, focused: v.id === focusId,
      });
    }

    for (const v of this.satelliteLayer?.views ?? []) {
      if (!v.visible || !sky) continue;
      const key = `sat:${v.id}`;
      if (!LABELLED_SATELLITES.has(v.id) && this.selection !== key) continue;
      const s = this.project(v.rel);
      if (!s || this.belowHorizon(v.rel) || !free(s[0], s[1])) continue;
      placed.push(s);
      items.push({ key, text: v.name.replace(/ \(.*\)$/, ''), kind: 'satellite', x: s[0], y: s[1], marker: false, offset: 7 });
    }

    if (this.starLayer && this.starLayer.object.visible) {
      const pos = this.starLayer.stars.positions;
      const absMag = this.starLayer.stars.absMag;
      const cam = this.cameraPc();
      const rel: Vec3 = [0, 0, 0];
      let count = 0;
      const labelMag = Math.min(STAR_LABEL_MAG, this.magLimit - 0.5);
      for (const n of this.starLabelNames) {
        rel[0] = pos[n.i * 3]! - cam[0];
        rel[1] = pos[n.i * 3 + 1]! - cam[1];
        rel[2] = pos[n.i * 3 + 2]! - cam[2];
        const d = Math.hypot(rel[0], rel[1], rel[2]);
        if (apparentMagnitude(absMag[n.i]!, d) > labelMag) continue;
        if (this.belowHorizon(rel)) continue;
        const s = this.project(rel);
        if (!s || !free(s[0], s[1])) continue;
        if (this.occluded([rel[0] * PC, rel[1] * PC, rel[2] * PC], d * PC, '')) continue;
        placed.push(s);
        items.push({ key: `star:${n.i}`, text: starDisplayName(n)!, kind: 'star', x: s[0], y: s[1], marker: false, offset: 7 });
        if (++count >= MAX_STAR_LABELS) break;
      }
    }

    items.push(...this.deep.labels(
      (rel) => this.project(rel), free, placed, this.ctx.pixelsPerRadian, this.magLimit, (rel) => this.belowHorizon(rel),
    ));

    const con = this.constellationLayer;
    if (con && this.skyOptions.names && con.fade > 0.2) {
      // Only major constellations when zoomed out widely, all of them when zoomed in.
      const maxRank = this.rig.fovDeg > 80 ? 1 : this.rig.fovDeg > 40 ? 2 : 3;
      for (const c of con.labels) {
        if (c.rank > maxRank || this.belowHorizon(c.dir)) continue;
        const s = this.project(c.dir, 0.95);
        if (!s || !free(s[0], s[1])) continue;
        placed.push(s);
        items.push({ key: `con:${c.id}`, text: c.name, kind: 'constellation', x: s[0], y: s[1], marker: false, offset: 0 });
      }
    }

    if (sky && this.skyOptions.ground) {
      CARDINALS.forEach((label, i) => {
        const dir = this.skyRig.directionFor((i * Math.PI) / 4, 0.4 * DEG);
        const s = this.project(dir);
        if (s) items.push({ key: `card:${label}`, text: label, kind: 'cardinal', x: s[0], y: s[1], marker: false, offset: 0 });
      });
    }
    return items;
  }

  /** True if another body's disc lies between the camera and the given point. */
  private occluded(rel: Readonly<Vec3>, dist: number, selfId: string): boolean {
    const ux = rel[0] / dist, uy = rel[1] / dist, uz = rel[2] / dist;
    for (const o of this.solarLayer.views) {
      if (o.id === selfId || o.distance >= dist || !o.shown) continue;
      const along = o.rel[0] * ux + o.rel[1] * uy + o.rel[2] * uz;
      if (along <= 0) continue;
      const px = o.rel[0] - along * ux, py = o.rel[1] - along * uy, pz = o.rel[2] - along * uz;
      if (Math.hypot(px, py, pz) < this.solar.get(o.id)!.info.radius) return true;
    }
    return false;
  }

  /** Camera-relative vector to the selection, if it is currently placed. */
  private selectionRel(key: string): Vec3 | null {
    if (key.startsWith('body:')) return this.solarLayer.getView(key.slice(5))?.rel ?? null;
    if (key.startsWith('sat:')) {
      const v = this.satelliteLayer?.views.find((s) => `sat:${s.id}` === key);
      return v && this.satelliteLayer!.object.visible ? v.rel : null;
    }
    if (key.startsWith('star:') && this.starLayer) {
      const i = Number(key.slice(5));
      const p = this.starLayer.stars.positions;
      const cam = this.cameraPc();
      return [p[i * 3]! - cam[0], p[i * 3 + 1]! - cam[1], p[i * 3 + 2]! - cam[2]];
    }
    return this.deep.selectionRel(key, this.cameraPc(), [0, 0, 0]);
  }

  private selectionDirection(key: string): Vec3 | null {
    const r = this.selectionRel(key);
    if (!r) return null;
    const l = Math.hypot(...r) || 1;
    return [r[0] / l, r[1] / l, r[2] / l];
  }

  /** Full topocentric description of the selection, as seen from the observer location. */
  private selectionInfo(t: AstroTime): SelectionInfo | null {
    const key = this.selection;
    if (!key) return null;
    const obs = this.skyCtx?.observer ?? observerState(this.ephemeris, t, this.geodetic);
    const precise = this.ephemeris.isPrecise(t.jdTdb);
    const conName = (raJ: number, decJ: number) => {
      if (!this.constellationData) return undefined;
      const id = constellationAt(this.constellationData, raJ / DEG, decJ / DEG);
      return id ? this.constellationData[id]?.name : undefined;
    };

    if (key.startsWith('body:')) {
      const id = key.slice(5) as SolarBodyId;
      const info = SOLAR_SYSTEM.find((b) => b.id === id);
      if (!info) return null;
      if (id === 'earth') return null;
      const p = apparentBody(this.ephemeris, obs, id);
      const ph = bodyPhotometry(this.ephemeris, obs, id);
      const details: [string, string][] = [];
      if (id !== 'sun') details.push(['Illuminated', `${(ph.illuminated * 100).toFixed(0)}%`]);
      return {
        key, kind: info.kind === 'star' ? 'star' : (info.kind as SelectionKind), name: info.name, details, travelable: true,
        constellation: conName(p.raJ2000, p.decJ2000),
        raJ2000: p.raJ2000, decJ2000: p.decJ2000, ra: p.ra, dec: p.dec, alt: p.altRefracted, az: p.horizontal.az,
        distance: p.distanceKm * 1000, magnitude: ph.magnitude, approximate: !precise, target: { kind: 'body', id },
      };
    }

    if (key.startsWith('star:') && this.starLayer) {
      const i = Number(key.slice(5));
      const s = this.starLayer.stars;
      const pc: Vec3 = [s.positions[i * 3]!, s.positions[i * 3 + 1]!, s.positions[i * 3 + 2]!];
      const posKm: Vec3 = [pc[0] * PC_KM, pc[1] * PC_KM, pc[2] * PC_KM];
      const p = apparentFixed(obs, posKm);
      const distPc = Math.hypot(...pc);
      const unknownDistance = (s.flags[i]! & 1) === 1;
      const entry = this.starNames.get(i);
      const details: [string, string][] = [];
      if (entry?.spect) details.push(['Spectral type', entry.spect]);
      if (entry?.hip) details.push(['Catalogue', `HIP ${entry.hip}`]);
      const bayer = entry && starDisplayName({ ...entry, name: undefined });
      if (entry?.name && bayer) details.push(['Designation', bayer]);
      return {
        key, kind: 'star', name: (entry && starDisplayName(entry)) ?? `HYG star #${i}`, details, travelable: false,
        constellation: conName(p.raJ2000, p.decJ2000),
        raJ2000: p.raJ2000, decJ2000: p.decJ2000, ra: p.ra, dec: p.dec, alt: p.altRefracted, az: p.horizontal.az,
        distance: unknownDistance ? undefined : distPc * PC,
        magnitude: apparentMagnitude(s.absMag[i]!, distPc),
        approximate: unknownDistance,
        target: { kind: 'fixed', positionKm: posKm },
      };
    }

    if (key.startsWith('sat:') && this.satelliteLayer) {
      const idx = this.satelliteLayer.views.findIndex((v) => `sat:${v.id}` === key);
      const sat = this.satelliteLayer.satellites[idx];
      if (!sat) return null;
      const itrs: Vec3 = [0, 0, 0];
      if (!satelliteItrs(sat, t.jdUtc, itrs)) return null;
      const geo = mulMat3Vec(obs.orientation.itrsToEcliptic, itrs);
      const rel: Vec3 = [geo[0] - obs.geocentric[0], geo[1] - obs.geocentric[1], geo[2] - obs.geocentric[2]];
      const p = apparentFromVector(obs, rel);
      const view = this.satelliteLayer.views[idx]!;
      const ageDays = t.jdUtc - sat.epochJd;
      return {
        key, kind: 'satellite', name: sat.name, travelable: false,
        details: [
          ['NORAD id', String(sat.noradId)],
          ['Sunlit', view.sunlit ? 'yes' : 'no (in Earth’s shadow)'],
          ['Elements age', `${ageDays.toFixed(1)} days`],
        ],
        raJ2000: p.raJ2000, decJ2000: p.decJ2000, ra: p.ra, dec: p.dec, alt: p.altRefracted, az: p.horizontal.az,
        distance: p.distanceKm * 1000, magnitude: view.sunlit && this.mode === 'sky' ? view.magnitude : undefined,
        approximate: Math.abs(ageDays) > 7,
        tle: sat.tle,
      };
    }

    const deep = this.deep.describe(key);
    if (deep) {
      const p = apparentFixed(obs, deep.positionKm);
      return {
        key, kind: deep.kind === 'star' ? 'star' : deep.kind, name: deep.name, subtitle: deep.subtitle,
        details: deep.details, travelable: deep.kind !== 'star' && deep.distanceM !== undefined,
        constellation: conName(p.raJ2000, p.decJ2000),
        raJ2000: p.raJ2000, decJ2000: p.decJ2000, ra: p.ra, dec: p.dec, alt: p.altRefracted, az: p.horizontal.az,
        distance: deep.distanceM, magnitude: deep.magnitude, approximate: deep.approximate,
        target: { kind: 'fixed', positionKm: deep.positionKm },
      };
    }
    return null;
  }

  /** Display name of the current orbit centre. */
  private focusName(id: string): string {
    const body = this.solar.get(id);
    if (body) return body.info.name;
    return FOCUS_NAMES[id] ?? this.deep.describe(id)?.name ?? id;
  }

  private trackPerformance(now: number): void {
    this.fpsFrames++;
    const span = now - this.fpsStart;
    if (span >= 500) {
      this.fps = (this.fpsFrames * 1000) / span;
      this.frameMs = span / this.fpsFrames;
      this.fpsFrames = 0;
      this.fpsStart = now;
    }
  }

  private emitStats(t: AstroTime): void {
    if (this.statsListeners.size === 0) return;
    const sunRel = this.ctx.toCamera(this.frames.require(SUN_FRAME_ID), [0, 0, 0], this.scratch);
    const focusId = this.mode === 'sky' ? 'earth' : this.orbitRig.target.id;
    const focusFrame = this.mode === 'sky' ? this.solar.get('earth')!.frame : this.orbitRig.target.frame;
    const distance = this.mode === 'sky' ? this.skyRig.altitude : this.orbitRig.distance;
    const origin: Vec3 = [0, 0, 0];
    const lengthTo = (id: string) => {
      const d = this.frames.difference(focusFrame, origin, this.solar.get(id)!.frame, origin);
      return Math.hypot(d[0], d[1], d[2]);
    };
    const stats: EngineStats = {
      mode: this.mode,
      fps: this.fps,
      frameMs: this.frameMs,
      fovDeg: this.rig.fovDeg,
      focusId,
      focusName: this.focusName(focusId),
      distance,
      altitude: this.rig.altitude,
      speed: this.speed,
      metresPerPixel: distance / this.ctx.pixelsPerRadian,
      distanceFromSun: Math.hypot(sunRel[0], sunRel[1], sunRel[2]),
      focusFromSun: lengthTo('sun'),
      focusFromEarth: lengthTo('earth'),
      simTimeMs: t.utcMs,
      rate: this.time.rate,
      paused: this.time.paused,
      depthMode: this.depthMode,
      starsLoaded: !!this.starLayer,
      precise: this.ephemeris.isPrecise(t.jdTdb),
      observer: this.observer,
      sunAltDeg: this.skyCtx ? this.skyCtx.sunAlt / DEG : null,
      view: this.mode === 'sky' ? { az: this.skyRig.az, alt: this.skyRig.alt } : null,
      selection: this.selectionInfo(t),
      satellites: this.tleInfo,
      deep: this.deep.stats,
      exposureMag: this.ctx.exposure.pointMag,
    };
    for (const cb of this.statsListeners) cb(stats);
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
