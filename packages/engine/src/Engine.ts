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
  ALL_BODIES, AU, C_KM_PER_DAY, DEG, EQUATORIAL_TO_ECLIPTIC, Ephemeris, type GeodeticLocation, KPC, LY, MPC, PC,
  type Satellite, type SolarBodyId, type Target, type Tle, type Vec3, type AstroTime, apparentBody, apparentFixed,
  apparentFromVector, apparentMagnitude, apparentMoon, bodyPhotometry, createSatellite, findBody, isFittedMoon,
  moonPhotometry, mulMat3Vec, observerState, satelliteItrs, sphericalToCartesian, ECLIPTIC_TO_EQUATORIAL,
  astroTimeFromUnixMs, cartesianToSpherical, describeSpectralType, starPhysics,
} from '@simuverse/astro';
import {
  type CatalogEntry, type Constellations, EphemerisLoader, type SearchEntry, type SearchHit, SearchIndex, type StarNameEntry,
  type TleResult, constellationAt, loadConstellationArt, loadConstellations, loadStarCatalog, loadStarNames, loadTles, starDisplayName,
} from '@simuverse/data';
import {
  ACESFilmicToneMapping, DepthTexture, FloatType, HalfFloatType, PerspectiveCamera, Quaternion, Scene, TextureLoader,
  Vector2, Vector3, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { CameraRig } from './CameraRig.ts';
import { DeepSpace, type DeepQuality, type DeepSpaceStats } from './DeepSpace.ts';
import { FlyCameraRig } from './FlyCameraRig.ts';
import { FrameGraph } from './frames.ts';
import { GpuTimer } from './GpuTimer.ts';
import { type LabelItem, LabelLayer } from './LabelLayer.ts';
import { LensFlarePass } from './LensFlarePass.ts';
import { AtmosphereLayer } from './layers/AtmosphereLayer.ts';
import { ConstellationArtLayer } from './layers/ConstellationArtLayer.ts';
import { ConstellationLayer } from './layers/ConstellationLayer.ts';
import { GroundLayer } from './layers/GroundLayer.ts';
import { SatelliteLayer } from './layers/SatelliteLayer.ts';
import { SolarSystemLayer, TEXTURES } from './layers/SolarSystemLayer.ts';
import { StarLayer } from './layers/StarLayer.ts';
import type { RenderContext, SkyContext, ViewMode } from './layers/types.ts';
import { OrbitCameraRig, type OrbitTarget } from './OrbitCameraRig.ts';
import { ResolutionGovernor } from './resolution.ts';
import { exposureFor, galaxyMagRef, ladderStep, sceneFogMpc } from './scale.ts';
import { SkyCameraRig } from './SkyCameraRig.ts';
import { SkyEvents, type SkyEventsResponse } from './SkyEvents.ts';
import { limitingMagnitude } from './skyBrightness.ts';
import { SUN_FRAME_ID, SolarSystemModel } from './SolarSystemModel.ts';
import { SmallBodies } from './SmallBodies.ts';
import { StarSystems } from './StarSystems.ts';
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

/** Universe-view navigation: orbit a target, or fly freely. */
export type NavMode = 'orbit' | 'fly';

const ZOOM_LEVELS: readonly ZoomLevel[] = ['sky', 'planet', 'solar-system', 'milky-way', 'local-group', 'virgo', 'laniakea', 'universe'];
const LADDER_TARGET: Partial<Record<ZoomLevel, string>> = {
  'milky-way': 'galaxy', 'local-group': 'local-group', virgo: 'virgo', laniakea: 'laniakea', universe: 'universe',
};

/** Long Greek-letter names for Bayer designations ("Alpha Centauri"). */
const GREEK_LONG: Record<string, string> = {
  Alp: 'Alpha', Bet: 'Beta', Gam: 'Gamma', Del: 'Delta', Eps: 'Epsilon', Zet: 'Zeta', Eta: 'Eta', The: 'Theta',
  Iot: 'Iota', Kap: 'Kappa', Lam: 'Lambda', Mu: 'Mu', Nu: 'Nu', Xi: 'Xi', Omi: 'Omicron', Pi: 'Pi', Rho: 'Rho',
  Sig: 'Sigma', Tau: 'Tau', Ups: 'Upsilon', Phi: 'Phi', Chi: 'Chi', Psi: 'Psi', Ome: 'Omega',
};

/** Places to jump to by name (scale levels). */
const REGIONS: { level: ZoomLevel; name: string; aliases: string[]; detail: string }[] = [
  { level: 'solar-system', name: 'Solar System', aliases: [], detail: 'The Sun and its planets' },
  { level: 'milky-way', name: 'Milky Way', aliases: ['Our Galaxy', 'The Galaxy', 'Galactic Centre', 'Galactic Center'], detail: 'Our galaxy' },
  { level: 'local-group', name: 'Local Group', aliases: [], detail: 'Our group of galaxies' },
  { level: 'virgo', name: 'Virgo Supercluster', aliases: ['Virgo Cluster', 'Local Supercluster'], detail: 'Galaxy cluster' },
  { level: 'laniakea', name: 'Laniakea Supercluster', aliases: ['Laniakea', 'Great Attractor'], detail: 'Our supercluster' },
  { level: 'universe', name: 'Observable Universe', aliases: ['Cosmic microwave background', 'CMB', 'Cosmic web'], detail: 'Everything we can see' },
];

/** A shareable description of the view (resolved through stable references, not engine keys). */
export interface ViewState {
  mode: 'sky' | 'orbit' | 'fly';
  /** Orbit centre / fly reference object: a stable reference (see Engine.refFor). */
  target?: string;
  /** Orbit: direction from the target (ecliptic az/el, radians) and distance (m). Sky: view az/alt (radians). */
  az?: number;
  el?: number;
  dist?: number;
  /** Sky: field of view, degrees. */
  fov?: number;
  /** Fly: camera offset from the target (m, ecliptic) and orientation quaternion. */
  pos?: Vec3;
  quat?: [number, number, number, number];
  selection?: string;
  /** Simulated time (UTC ms); absent when following the real clock. */
  timeMs?: number;
  rate?: number;
  paused?: boolean;
}

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
  /** Constellation artwork (downloaded the first time it is shown). */
  art: boolean;
  names: boolean;
  bounds: boolean;
  ground: boolean;
  atmosphere: boolean;
  satellites: boolean;
  /** Naked-eye limiting magnitude under a dark sky (light pollution). */
  darkSkyLimit: number;
}

export const DEFAULT_SKY_OPTIONS: SkyOptions = {
  figures: true, art: false, names: true, bounds: false, ground: true, atmosphere: true, satellites: true, darkSkyLimit: 6.5,
};

export type SelectionKind =
  | 'star' | 'planet' | 'moon' | 'dwarf-planet' | 'satellite' | 'galaxy' | 'nebula' | 'cluster' | 'exoplanet'
  | 'small-body' | 'black-hole' | 'neutron-star';

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
  /** Main-thread time spent in the frame callback, ms (smoothed). */
  cpuMs: number;
  /** GPU time for the frame, ms (smoothed), where the browser can measure it. */
  gpuMs: number | null;
  /** Draw calls in the last frame, across all passes. */
  drawCalls: number;
  /** Adaptive-resolution scale (1 = full resolution for the quality preset). */
  renderScale: number;
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
  nav: NavMode;
  /** Warp in progress: destination, progress 0–1 and seconds remaining. */
  warp: { name: string; progress: number; remaining: number } | null;
  /** Fly-mode speed multiplier. */
  flyFactor: number;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** Element overlaying the canvas for DOM labels. */
  overlay: HTMLElement;
  dataBaseUrl: string;
  textureBaseUrl: string;
  quality?: QualityPreset;
  /** Lower the render resolution when frames are slow (default on). */
  adaptiveResolution?: boolean;
  /** Lens flare from the Sun (default off). */
  lensFlare?: boolean;
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
  readonly flyRig: FlyCameraRig;
  readonly depthMode: DepthMode;
  private readonly events: SkyEvents;

  private mode: ViewMode;
  private nav: NavMode = 'orbit';
  private readonly systems: StarSystems;
  readonly smallBodies: SmallBodies;
  private searchCache: { index: SearchIndex; version: string } | null = null;
  private catalogCache: { entries: CatalogEntry[]; version: string } | null = null;
  /** While true the 3D view isn't drawn (e.g. a full-page panel covers it); time and stats keep running. */
  private suspended = false;
  private readonly governor = new ResolutionGovernor(0.5);
  private readonly lensFlare = new LensFlarePass();
  private flareOn: boolean;
  private adaptive: boolean;
  /** Frames before this time (start-up, data loading) don't count towards adaptive resolution. */
  private governorFrom = performance.now() + 4000;
  /** Destination of the warp in progress (for the HUD). */
  private warpName = '';
  /** Fly mode: nearest object key and smoothed log of the distance to it. */
  private flyNearest = 'sun';
  private flyRefLog = Math.log(1e7);
  private lastHiddenRefresh = 0;
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
  private artLayer: ConstellationArtLayer | null = null;
  private artRequested = false;
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
  private cpuMs = 0;
  private drawCalls = 0;
  private readonly gpuTimer: GpuTimer;
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
    this.adaptive = opts.adaptiveResolution ?? true;
    this.flareOn = opts.lensFlare ?? false;
    this.depthMode = supportsReversedZ() ? 'reversed-z' : 'logarithmic';
    this.renderer = new WebGLRenderer({
      canvas: opts.canvas,
      antialias: false, // MSAA happens on the HDR target instead
      powerPreference: 'high-performance',
      reversedDepthBuffer: this.depthMode === 'reversed-z',
      logarithmicDepthBuffer: this.depthMode === 'logarithmic',
    });
    // Counted across every pass of a frame (the composer renders several).
    this.renderer.info.autoReset = false;
    this.gpuTimer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
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
    this.flyRig = new FlyCameraRig(earth.frame, opts.reducedMotion);
    this.smallBodies = new SmallBodies(this.scene, this.frames, this.frames.require(SUN_FRAME_ID), new URL(opts.dataBaseUrl, location.href).href);
    this.systems = new StarSystems(this.scene, this.frames, this.frames.require(SUN_FRAME_ID), new URL(opts.dataBaseUrl, location.href).href, {
      hyg: () => this.starLayer?.stars ?? null,
      hygName: (i) => {
        const n = this.starNames.get(i);
        return n ? starDisplayName(n) : undefined;
      },
      tyc: (id) => this.deep.tycStar(id),
      hideHyg: (i) => this.starLayer?.hideStar(i),
      hideTyc: (id) => this.deep.hideTyc(id),
    });

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
    return this.mode === 'sky' ? this.skyRig : this.nav === 'fly' ? this.flyRig : this.orbitRig;
  }

  /** The Universe-view rig (orbit or fly), whichever is active. */
  private get spaceRig(): CameraRig {
    return this.nav === 'fly' ? this.flyRig : this.orbitRig;
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
    if (this.artLayer) this.artLayer.visible = this.skyOptions.art;
    else if (this.skyOptions.art) this.loadArt();
  }

  private loadArt(): void {
    if (this.artRequested) return;
    this.artRequested = true;
    const base = new URL(this.opts.dataBaseUrl, location.href).href;
    Promise.all([loadConstellationArt(base), new TextureLoader().loadAsync(new URL('constellation-art.jpg', base).href)])
      .then(([art, atlas]) => {
        if (this.disposed) return;
        this.artLayer = new ConstellationArtLayer(art, atlas, this.renderer.capabilities.getMaxAnisotropy());
        this.artLayer.visible = this.skyOptions.art;
        this.scene.add(this.artLayer.object);
      })
      .catch((err) => {
        this.artRequested = false;
        console.error('Constellation art failed to load', err);
      });
  }

  /** Switch to Sky view (standing at the observer location). */
  enterSky(): void {
    if (this.mode === 'sky') return;
    this.setMode('sky');
    this.prepareSkyView(false);
  }

  /**
   * Go to anything: a solar-system body ('jupiter' or 'body:jupiter'), a star
   * ('star:', 'tyc:'), an exoplanet system or planet ('exo:', 'exop:'), a deep
   * object ('gal:', 'dso:'), a scale level ('region:milky-way'), a satellite
   * or a constellation ('sat:', 'con:', Sky view only). In Universe mode the
   * camera warps there; in Sky mode it is selected and the view turns to it.
   */
  focus(id: string): void {
    if (id.startsWith('body:')) id = id.slice(5);
    if (id.startsWith('region:')) {
      const level = id.slice(7) as ZoomLevel;
      if (ZOOM_LEVELS.includes(level)) this.zoomToLevel(level);
      return;
    }
    if (id.startsWith('sat:') || id.startsWith('con:')) {
      if (this.mode !== 'sky') this.enterSky();
      if (id.startsWith('sat:')) {
        this.selection = id;
        this.centerOnSelection();
      } else this.lookAtConstellation(id.slice(4));
      this.emitStats(this.ctx.time);
      return;
    }
    const isBody = !!this.solar.get(id);
    const target = this.targetFor(id);
    // In Sky view anything with a direction can be selected; travel needs a target.
    if (!target && (this.mode === 'universe' || isBody)) return;
    // Earth can't be 'seen' by an observer standing on it; focusing it just clears the selection.
    this.selection = id === 'earth' ? null : isBody ? `body:${id}` : id;
    if (this.mode === 'sky') this.centerOnSelection();
    else this.travelTo(id, target!);
    this.emitStats(this.ctx.time);
  }

  /** Travels to an object in Universe view, leaving Sky view first if needed. */
  travel(key: string): void {
    if (this.mode === 'sky' && !key.startsWith('sat:') && !key.startsWith('con:')) this.liftOff();
    this.focus(key);
  }

  /** Shows an object in the observer's sky (Sky view, turned towards it and selected). */
  showInSky(key: string): void {
    this.enterSky();
    this.focus(key);
  }

  /** Warps the orbit camera to a target and arrives at a good viewpoint. */
  private travelTo(id: string, target: OrbitTarget): void {
    if (this.nav === 'fly') this.setNavMode('orbit', false);
    this.orbitRig.warpTo(target, this.viewDistanceFor(id, target), this.arrivalFor(id));
    this.warpName = this.focusName(id);
  }

  private viewDistanceFor(id: string, target: OrbitTarget): number {
    if (this.solar.get(id)) return target.radius * (id === 'sun' || id === 'saturn' ? 6 : isFittedMoon(id) ? 4 : 3.2);
    if (this.systems.isStarKey(id) || id.startsWith('exop:')) return this.systems.viewDistance(id);
    if (id.startsWith('sb:')) return this.smallBodies.viewDistance(id);
    return this.deep.viewDistance(id);
  }

  /** Arrival viewpoint (unit vector from the target), or null to keep the approach direction. */
  private arrivalFor(id: string): Vec3 | null {
    const frame = this.solar.get(id)?.frame ?? (id.startsWith('sb:') ? this.smallBodies.frameOf(id) : undefined);
    if (frame) {
      if (id === 'sun') return null;
      // Three-quarter lit: 45° round from the Sun direction, a little above the ecliptic.
      const s = this.frames.difference(frame, [0, 0, 0], this.frames.require(SUN_FRAME_ID), [0, 0, 0]);
      const l = Math.hypot(s[0], s[1], s[2]) || 1;
      const c = Math.cos(45 * DEG), n = Math.sin(45 * DEG);
      return [(s[0] * c - s[1] * n) / l, (s[0] * n + s[1] * c) / l, s[2] / l + 0.35];
    }
    if (this.systems.isStarKey(id) || id.startsWith('exop:')) return this.systems.arrivalDirection(id, this.ctx.time.jdTdb);
    return this.deep.arrivalDirection(id);
  }

  /** Turns Sky view to a constellation's label point. */
  private lookAtConstellation(id: string): void {
    const c = this.constellationData?.[id];
    if (!c) return;
    const dir = mulMat3Vec(EQUATORIAL_TO_ECLIPTIC, sphericalToCartesian(c.label[0] * DEG, c.label[1] * DEG));
    this.skyRig.place(this.solar.earth);
    const { az, alt } = this.skyRig.horizontalOf(dir);
    this.skyRig.lookAt(az, alt);
  }

  get navMode(): NavMode {
    return this.nav;
  }

  /**
   * Switches Universe-view navigation. Entering fly mode keeps the current
   * pose; leaving it orbits the selection (if it can be travelled to) or the
   * nearest object, from exactly where the camera is.
   */
  setNavMode(m: NavMode, emit = true): void {
    if (m === this.nav) return;
    if (m === 'fly') {
      if (this.mode === 'sky') {
        // Finish the lift-off at once: start flying from orbit, not from the ground.
        this.liftOff();
        const earth = this.targetFor('earth')!;
        this.orbitRig.place(earth, this.orbitRig.azimuth, this.orbitRig.elevation, earth.radius * 3.2);
      }
      this.orbitRig.cancelWarp();
      this.flyRig.takeOver(this.orbitRig.anchor, this.orbitRig.offset, this.orbitRig.quaternion);
      this.flyRefLog = Math.log(Math.max(this.orbitRig.altitude, 1));
      this.flyRig.reference = this.orbitRig.altitude;
      this.nav = 'fly';
    } else {
      this.flyRig.releaseKeys();
      const sel = this.selection?.startsWith('body:') ? this.selection.slice(5) : this.selection;
      const id = sel && this.targetFor(sel) ? sel : this.flyNearest;
      const target = this.targetFor(id) ?? this.targetFor('sun')!;
      const d = this.frames.difference(target.frame, [0, 0, 0], this.flyRig.anchor, this.flyRig.offset);
      this.orbitRig.takeOver(target, this.flyRig.anchor, [...this.flyRig.offset], this.flyRig.quaternion, Math.hypot(d[0], d[1], d[2]), 'exact');
      this.nav = 'orbit';
    }
    if (emit) this.emitStats(this.ctx.time);
  }

  // ---------------------------------------------------------------- search & sharing

  /** Searches every catalogue by name or designation. */
  search(query: string, limit = 30): SearchHit[] {
    return this.searchIndex().search(query, limit);
  }

  /** Goes somewhere interesting, chosen at random; returns the key. */
  surprise(): string | null {
    const current = this.mode === 'universe' ? this.orbitRig.target.id : '';
    const pool = this.searchIndex().entries((e) =>
      e.key !== current && e.key !== `body:${current}` && e.key !== 'body:earth' && (
        (e.kind === 'galaxy' && e.rank < 50) || ((e.kind === 'nebula' || e.kind === 'cluster') && e.rank < 16)
        || (e.kind === 'system' && e.rank < 48) || (e.kind === 'exoplanet' && e.rank < 50) || e.kind === 'moon'
        || e.kind === 'body' || (e.kind === 'star' && e.rank < 30)),
    );
    if (!pool.length) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    if (this.mode === 'sky') this.liftOff();
    this.focus(pick.key);
    return pick.key;
  }

  /** A reference to an object that survives data rebuilds (catalogue designation or name), for URLs. */
  refFor(key: string): string {
    if (key.startsWith('body:')) key = key.slice(5);
    if (this.solar.get(key) || FOCUS_NAMES[key] || key === 'sun') return key;
    return this.searchIndex().byKey(key)?.ref ?? key;
  }

  /** Resolves a reference from refFor() back to an engine key, or null if it isn't known (yet). */
  resolveRef(ref: string): string | null {
    if (this.solar.get(ref) || FOCUS_NAMES[ref]) return ref;
    if (/^(gal|dso|star|tyc|exo|exop|sb|exotic):/.test(ref)) return this.targetFor(ref) ? ref : null;
    if (/^(sat|con|region):/.test(ref)) return ref;
    const e = this.searchIndex().resolve(ref);
    return e ? (e.key.startsWith('body:') ? e.key.slice(5) : e.key) : null;
  }

  getViewState(): ViewState {
    const t = this.time;
    const live = !t.paused && t.rate === 1 && Math.abs(t.nowMs() - Date.now()) < 60_000;
    const time = live ? {} : { timeMs: Math.round(t.nowMs()), rate: t.rate, paused: t.paused };
    const selection = this.selection ? this.refFor(this.selection) : undefined;
    if (this.mode === 'sky') {
      return { mode: 'sky', az: this.skyRig.az, el: this.skyRig.alt, fov: this.skyRig.fovDeg, selection, ...time };
    }
    if (this.nav === 'fly') {
      const target = this.targetFor(this.flyNearest) ?? this.targetFor('sun')!;
      const pos = this.frames.difference(target.frame, [0, 0, 0], this.flyRig.anchor, this.flyRig.offset);
      const q = this.flyRig.quaternion;
      return { mode: 'fly', target: this.refFor(target.id), pos, quat: [q.x, q.y, q.z, q.w], selection, ...time };
    }
    const r = this.orbitRig;
    return { mode: 'orbit', target: this.refFor(r.target.id), az: r.azimuth, el: r.elevation, dist: r.distance, selection, ...time };
  }

  /**
   * Restores a view. Returns false if a referenced object isn't loaded yet
   * (catalogues stream in), so callers can retry.
   */
  applyViewState(v: ViewState): boolean {
    let targetKey: string | null = null;
    if (v.mode !== 'sky') {
      targetKey = v.target ? this.resolveRef(v.target) : 'sun';
      if (!targetKey) return false;
    }
    const sel = v.selection ? this.resolveRef(v.selection) : null;
    if (v.selection && !sel) return false;
    if (v.timeMs !== undefined && Number.isFinite(v.timeMs)) this.time.setTimeMs(v.timeMs);
    if (v.rate !== undefined && Number.isFinite(v.rate)) this.time.setRate(v.rate);
    if (v.paused !== undefined) this.time.setPaused(v.paused);
    this.selection = sel ? (this.solar.get(sel) ? `body:${sel}` : sel) : null;
    if (v.mode === 'sky') {
      this.enterSky();
      this.skyRig.lookAt(v.az ?? 0, v.el ?? 0.4, true);
      if (v.fov) this.skyRig.setFov(v.fov);
    } else {
      if (this.mode === 'sky') this.liftOff();
      const target = this.targetFor(targetKey!)!;
      if (v.mode === 'fly' && v.pos && v.quat) {
        this.setNavMode('fly', false);
        this.flyRig.takeOver(target.frame, v.pos, this.flyRig.quaternion.set(...v.quat).normalize());
        this.flyNearest = target.id;
      } else {
        this.setNavMode('orbit', false);
        this.orbitRig.place(target, v.az ?? 0, v.el ?? 0.3, v.dist ?? target.radius * 3.2 + 1e7);
      }
    }
    this.emitStats(this.time.now());
    return true;
  }

  private catalogVersion(): string {
    return [
      this.deep.catalogVersion, this.systems.systems.length, this.starNames.size,
      this.satelliteLayer?.satellites.length ?? 0, this.constellationData ? 1 : 0, this.smallBodies.bodies.length,
    ].join(':');
  }

  setSuspended(v: boolean): void {
    this.suspended = v;
    if (v) this.labels.render([]);
  }

  /**
   * Every object in the Explore catalogue: bodies and moons, small bodies,
   * named stars, exoplanets, nebulae, clusters, galaxies, black holes and
   * neutron stars. Rebuilt when catalogues finish loading.
   */
  catalog(): CatalogEntry[] {
    const version = this.catalogVersion();
    if (this.catalogCache?.version === version) return this.catalogCache.entries;
    const t = this.time.now();
    const obs = observerState(this.ephemeris, t, this.geodetic);
    const dataBase = new URL(this.opts.dataBaseUrl, location.href).href;
    const textureBase = new URL(this.opts.textureBaseUrl, location.href).href;
    const out: CatalogEntry[] = [];
    const rankOf: Record<string, number> = { sun: 0, moon: 1, earth: 1, jupiter: 1, saturn: 1, mars: 1, venus: 2, mercury: 2, uranus: 2, neptune: 2, pluto: 4 };
    for (const b of ALL_BODIES) {
      const moon = isFittedMoon(b.id);
      const place = b.id === 'earth' ? null : moon ? apparentMoon(this.ephemeris, obs, b.id) : apparentBody(this.ephemeris, obs, b.id as SolarBodyId);
      const mag = b.id === 'earth' ? undefined : moon ? moonPhotometry(this.ephemeris, obs, b.id).magnitude : bodyPhotometry(this.ephemeris, obs, b.id as SolarBodyId).magnitude;
      const tex = TEXTURES[b.id];
      const parent = b.parent ? findBody(b.parent)?.name : undefined;
      out.push({
        key: `body:${b.id}`, ref: b.id, name: b.name, aliases: [], category: 'solar-system',
        type: b.kind === 'moon' ? `Moon of ${parent}` : b.kind === 'dwarf-planet' ? 'Dwarf planet' : b.kind === 'star' ? 'Our star (G2V main-sequence)' : 'Planet',
        distanceM: place ? place.distanceKm * 1000 : undefined, radiusM: b.radius, massKg: b.mass, magnitude: mag,
        raDeg: place ? place.raJ2000 / DEG : undefined, decDeg: place ? place.decJ2000 / DEG : undefined,
        luminositySun: b.id === 'sun' ? 1 : undefined, temperatureK: b.id === 'sun' ? 5772 : undefined,
        image: tex ? { url: textureBase + tex.map, credit: 'Solar System Scope (CC BY 4.0), based on NASA imagery', round: true } : undefined,
        rank: rankOf[b.id] ?? (b.radius > 1e6 ? 5 : 9), approximate: moon ? false : !this.ephemeris.isPrecise(t.jdTdb),
      });
    }
    const stars = this.starLayer?.stars;
    if (stars) {
      for (const n of this.starNames.values()) {
        const display = starDisplayName(n);
        if (!display) continue;
        const i = n.i;
        const pc: Vec3 = [stars.positions[i * 3]!, stars.positions[i * 3 + 1]!, stars.positions[i * 3 + 2]!];
        const d = Math.hypot(...pc);
        const placeholder = (stars.flags[i]! & 1) === 1;
        const ph = starPhysics(stars.absMag[i]!, stars.bv[i]!);
        const [ra, dec] = cartesianToSpherical(mulMat3Vec(ECLIPTIC_TO_EQUATORIAL, pc));
        const system = this.systems.systemForHyg(i);
        const aliases: string[] = [];
        const bayer = starDisplayName({ ...n, name: undefined });
        if (bayer && bayer !== display) aliases.push(bayer);
        if (n.hip) aliases.push(`HIP ${n.hip}`);
        const mag = apparentMagnitude(stars.absMag[i]!, d);
        out.push({
          key: `star:${i}`, ref: n.hip ? `HIP ${n.hip}` : display, name: display, aliases, category: 'star',
          type: describeSpectralType(n.spect, ph.teff) + (system ? ` · ${system.planets.length} known planet${system.planets.length === 1 ? '' : 's'}` : ''),
          distanceM: placeholder ? undefined : d * PC, radiusM: placeholder ? undefined : ph.radiusSun * 695_700e3,
          luminositySun: placeholder ? undefined : ph.lum, temperatureK: ph.teff, magnitude: mag,
          raDeg: ra / DEG, decDeg: dec / DEG, constellation: n.con, rank: Math.min(100, 8 + mag * 6), approximate: placeholder,
          extra: n.spect ? [['Spectral type', n.spect]] : undefined,
        });
      }
    }
    out.push(...this.systems.catalogEntries((i) => {
      const n = this.starNames.get(i);
      return !!n && !!starDisplayName(n);
    }));
    out.push(...this.smallBodies.catalogEntries(this.ephemeris, obs));
    out.push(...this.deep.catalogEntries(new URL('images/', dataBase).href));
    for (const e of out) {
      const c = e.constellation ? this.constellationData?.[e.constellation] : undefined;
      if (c) e.constellation = c.name;
    }
    this.catalogCache = { entries: out, version };
    return out;
  }

  /**
   * Tonight's dark window (Sun below −12°, the next one if it is daytime) and,
   * for each object, the highest it gets during it and when.
   */
  visibilityTonight(keys: string[]): { start: number; end: number; objects: Map<string, { maxAltDeg: number; atMs: number }> } | null {
    const nowMs = this.time.nowMs();
    const step = 10 * 60_000;
    const sunAlt = (ms: number) => {
      const o = observerState(this.ephemeris, astroTimeFromUnixMs(ms), this.geodetic);
      return { o, alt: apparentBody(this.ephemeris, o, 'sun').altRefracted / DEG };
    };
    let start = NaN, end = NaN;
    for (let ms = nowMs - 6 * 3600e3; ms < nowMs + 30 * 3600e3; ms += step) {
      const dark = sunAlt(ms).alt < -12;
      if (dark && Number.isNaN(start)) start = ms;
      if (!dark && !Number.isNaN(start)) {
        if (ms > nowMs) { end = ms; break; }
        start = NaN;
      }
    }
    if (Number.isNaN(start) || Number.isNaN(end)) return null; // polar summer: no dark sky
    start = Math.max(start, nowMs);
    const samples: { ms: number; o: ReturnType<typeof observerState> }[] = [];
    const n = 24;
    for (let k = 0; k <= n; k++) {
      const ms = start + ((end - start) * k) / n;
      samples.push({ ms, o: observerState(this.ephemeris, astroTimeFromUnixMs(ms), this.geodetic) });
    }
    const objects = new Map<string, { maxAltDeg: number; atMs: number }>();
    for (const key of keys) {
      const fixed = this.infoFor(key, this.time.now());
      if (!fixed) continue;
      const body = key.startsWith('body:') ? key.slice(5) : null;
      const sb = key.startsWith('sb:') ? Number(key.slice(3)) : null;
      let best = { maxAltDeg: -90, atMs: start };
      for (const smp of samples) {
        const p = body
          ? (isFittedMoon(body) ? apparentMoon(this.ephemeris, smp.o, body) : apparentBody(this.ephemeris, smp.o, body as SolarBodyId))
          : sb !== null ? this.smallBodies.apparent(this.ephemeris, smp.o, sb)
          : fixed.target?.kind === 'fixed' ? apparentFixed(smp.o, fixed.target.positionKm) : null;
        if (!p) break;
        const alt = p.altRefracted / DEG;
        if (alt > best.maxAltDeg) best = { maxAltDeg: alt, atMs: smp.ms };
      }
      if (best.maxAltDeg > -90) objects.set(key, best);
    }
    return { start, end, objects };
  }

  private searchIndex(): SearchIndex {
    const version = [
      this.deep.catalogVersion, this.systems.systems.length, this.starNames.size,
      this.satelliteLayer?.satellites.length ?? 0, this.constellationData ? 1 : 0, this.smallBodies.bodies.length,
    ].join(':');
    if (this.searchCache?.version === version) return this.searchCache.index;
    const index = new SearchIndex();
    index.add(this.coreSearchEntries());
    index.add(this.deep.searchEntries());
    index.add(this.systems.searchEntries());
    index.add(this.smallBodies.searchEntries());
    this.searchCache = { index, version };
    return index;
  }

  /** Bodies, scale levels, named stars, satellites and constellations. */
  private coreSearchEntries(): SearchEntry[] {
    const out: SearchEntry[] = [];
    const rankOf: Record<string, number> = { sun: 0, earth: 1, moon: 2, jupiter: 2, saturn: 2, mars: 2, venus: 3, mercury: 3, uranus: 3, neptune: 3, pluto: 5 };
    for (const b of ALL_BODIES) {
      const parent = b.parent ? findBody(b.parent)?.name : undefined;
      const detail = b.kind === 'moon' ? `Moon of ${parent}` : b.kind === 'dwarf-planet' ? 'Dwarf planet' : b.kind === 'star' ? 'Our star' : 'Planet';
      out.push({ key: `body:${b.id}`, ref: b.id, name: b.name, kind: b.kind === 'moon' ? 'moon' : 'body', rank: rankOf[b.id] ?? (b.radius > 1e6 ? 6 : 10), detail });
    }
    for (const r of REGIONS) out.push({ key: `region:${r.level}`, ref: `region:${r.level}`, name: r.name, aliases: r.aliases, kind: 'region', rank: 1, detail: r.detail });
    const stars = this.starLayer?.stars;
    for (const n of this.starNames.values()) {
      const display = starDisplayName(n);
      if (!display) continue;
      const aliases: string[] = [];
      const con = n.con ? this.constellationData?.[n.con] : undefined;
      if (n.bayer && n.con) {
        const bayer = starDisplayName({ ...n, name: undefined });
        if (bayer && bayer !== display) aliases.push(bayer);
        const [letter, sup] = n.bayer.split('-');
        if (con && GREEK_LONG[letter!]) aliases.push(`${GREEK_LONG[letter!]}${sup ?? ''} ${con.genitive}`);
      }
      if (n.flam && n.con) aliases.push(`${n.flam} ${n.con}`, ...(con ? [`${n.flam} ${con.genitive}`] : []));
      if (n.hip) aliases.push(`HIP ${n.hip}`);
      let rank = 40;
      if (stars) {
        const p = stars.positions, i = n.i;
        const mag = apparentMagnitude(stars.absMag[i]!, Math.hypot(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!));
        rank = Math.min(100, 8 + mag * 6);
      }
      out.push({ key: `star:${n.i}`, ref: n.hip ? `HIP ${n.hip}` : display, name: display, aliases, kind: 'star', rank, detail: n.spect ? `Star · ${n.spect}` : 'Star' });
    }
    for (const s of this.satelliteLayer?.satellites ?? []) {
      const short = s.name.replace(/ \(.*\)$/, '');
      const aliases = [s.name, `NORAD ${s.noradId}`];
      if (s.noradId === 25544) aliases.push('ISS', 'International Space Station');
      if (s.noradId === 20580) aliases.push('Hubble', 'Hubble Space Telescope');
      out.push({ key: `sat:${s.noradId}`, ref: `NORAD ${s.noradId}`, name: short, aliases, kind: 'satellite', rank: LABELLED_SATELLITES.has(s.noradId) ? 8 : 50, detail: 'Satellite · Sky view' });
    }
    for (const [id, c] of Object.entries(this.constellationData ?? {})) {
      out.push({ key: `con:${id}`, ref: c.name, name: c.name, aliases: [c.genitive, id], kind: 'constellation', rank: 10 + c.rank * 4, detail: 'Constellation · Sky view' });
    }
    return out;
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
      else if (this.targetFor(sel)) this.focus(sel);
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
    if (this.nav === 'fly') this.setNavMode('orbit', false);
    if (level === 'planet') {
      this.focus('earth');
      return;
    }
    if (level === 'solar-system') {
      const sun = this.targetFor('sun')!;
      this.orbitRig.warpTo(sun, 70 * AU, null);
      this.warpName = 'Solar System';
      this.emitStats(this.ctx.time);
      return;
    }
    const id = LADDER_TARGET[level]!;
    const target = this.deep.target(id);
    if (!target) return;
    this.orbitRig.warpTo(target, this.deep.viewDistance(id), this.deep.preferredViewDirection(id));
    this.warpName = FOCUS_NAMES[id] ?? id;
    this.emitStats(this.ctx.time);
  }

  setQuality(q: QualityPreset): void {
    if (q === this.quality) return;
    this.quality = q;
    this.governor.reset();
    this.governorFrom = performance.now() + 2000;
    this.deep.setQuality(QUALITY[q]);
    this.buildComposer();
    this.resize();
  }

  setLensFlare(on: boolean): void {
    this.flareOn = on;
  }

  setAdaptiveResolution(on: boolean): void {
    if (on === this.adaptive) return;
    this.adaptive = on;
    this.governor.reset();
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
    this.flyRig.setReducedMotion(v);
  }

  setLabelsVisible(v: boolean): void {
    this.showLabels = v;
  }

  setOrbitsVisible(v: boolean): void {
    this.solarLayer.setOrbitsVisible(v);
    this.systems.layer.showOrbits = v;
    this.smallBodies.showOrbits = v;
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
    // The drawing buffer isn't preserved between frames (that costs every frame), so draw one and read it at once.
    this.draw(0);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.gpuTimer.dispose();
    this.resizeObserver.disconnect();
    this.detach();
    this.events.dispose();
    this.labels.dispose();
    this.solarLayer.dispose();
    this.starLayer?.dispose();
    this.constellationLayer?.dispose();
    this.artLayer?.dispose();
    this.satelliteLayer?.dispose();
    this.atmosphere.dispose();
    this.ground.dispose();
    this.deep.dispose();
    this.systems.dispose();
    this.smallBodies.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- setup

  private targetFor(id: string): OrbitTarget | undefined {
    if (id.startsWith('body:')) id = id.slice(5);
    const b = this.solar.get(id);
    if (b) return { id, frame: b.frame, radius: b.info.radius };
    if (this.systems.isStarKey(id) || id.startsWith('exop:')) return this.systems.target(id);
    if (id.startsWith('sb:')) return this.smallBodies.target(id);
    return this.deep.target(id);
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
    this.nav = 'orbit';
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
        if (this.skyOptions.art) this.loadArt();
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
    this.composer.addPass(this.lensFlare);
    this.composer.addPass(new OutputPass());
  }

  private resize(): void {
    const el = this.opts.canvas.parentElement ?? this.opts.canvas;
    this.width = Math.max(1, el.clientWidth);
    this.height = Math.max(1, el.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].maxPixelRatio) * (this.adaptive ? this.governor.scale : 1);
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
      } else if (this.nav === 'fly') {
        // Same grab feel in flight: the scene follows the cursor.
        const radPerPx = (this.flyRig.fovDeg * DEG) / this.height;
        this.flyRig.look(dx * radPerPx, dy * radPerPx);
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
      else if (this.nav === 'fly') this.flyRig.scaleSpeed(-Math.sign(amount));
      else this.orbitRig.zoomBy(amount);
    };
    const flying = () => this.mode === 'universe' && this.nav === 'fly';
    const onKeyUp = (e: KeyboardEvent) => {
      this.flyRig.key(e.code, false);
    };
    const onBlur = () => this.flyRig.releaseKeys();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (flying() && !e.ctrlKey && !e.metaKey && !e.altKey && this.flyRig.key(e.code, true)) {
        e.preventDefault();
        return;
      }
      if (flying() && e.key === 'Shift') this.flyRig.key(e.code, true);
      const step = e.shiftKey ? 0.2 : 0.06;
      const sky = this.mode === 'sky';
      const turn = (dAz: number, dEl: number) => {
        if (sky) this.skyRig.panBy(dAz * this.skyRig.fovDeg * DEG * 0.5, dEl * this.skyRig.fovDeg * DEG * 0.5);
        else if (flying()) this.flyRig.look(dAz * 0.5, dEl * 0.5);
        else this.orbitRig.rotateBy(dAz, dEl);
      };
      const zoom = (a: number) => {
        this.zoomingOut = a > 0;
        if (sky) this.skyRig.zoomBy(a);
        else if (flying()) this.flyRig.scaleSpeed(-Math.sign(a));
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
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
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
    if ((key.startsWith('body:') || key.startsWith('exop:') || key.startsWith('sb:')) && this.mode === 'universe') this.focus(key);
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
    if (this.mode === 'universe') this.systems.pick(consider);
    this.smallBodies.pick((key, rel, reach, bias) => {
      if (!this.belowHorizon(rel)) consider(key, rel, reach, bias);
    }, this.magLimit);
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
    const travelOnClick = picked.key.startsWith('body:') || picked.key.startsWith('exop:') || picked.key.startsWith('sb:');
    if (travelOnClick && this.mode === 'universe' && this.nav === 'orbit') {
      const id = picked.key.startsWith('body:') ? picked.key.slice(5) : picked.key;
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
    const started = performance.now();
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
    if (this.mode === 'universe' && this.nav === 'fly') this.updateFlight(dt);
    else if (this.mode === 'universe' && !this.orbitRig.warping) {
      // Scale ladder: hand the orbit centre outward (Sun → Galaxy → Local Group → universe) and back.
      const id = this.orbitRig.target.id;
      const next = ladderStep(id, this.orbitRig.distance, this.zoomingOut, !!this.solar.get(id));
      const target = next ? this.targetFor(next) : undefined;
      if (target) this.orbitRig.retarget(target);
    }
    if (this.mode === 'universe' && this.nav === 'fly') this.speed = this.flyRig.speed;
    else if (this.mode === 'universe' && prevAnchor === this.rig.anchor && dt > 0) {
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
      : { ...exposureFor(Math.hypot(sunRel[0], sunRel[1], sunRel[2])), fogMpc: sceneFogMpc(this.spaceRig.focusDistance) };
    ctx.exposure = exposure;
    this.applyPhotometry(
      STAR_MAG_REF + exposure.pointMag,
      (this.skyCtx ? this.skyCtx.limitMag : SPACE_MAG_LIMIT) + exposure.pointMag,
    );
    // Galaxies: naked-eye photometry on the ground, scale-referenced in space.
    const galRef = this.skyCtx ? STAR_MAG_REF : galaxyMagRef(this.spaceRig.focusDistance, STAR_MAG_REF);
    this.deep.setGalaxyPhotometry(galRef, this.skyCtx ? this.skyCtx.limitMag : galRef + 2.5);
    this.solarLayer.update(ctx);
    this.smallBodies.update(ctx, this.mode === 'universe' && this.nav === 'orbit' ? this.orbitRig.target.id : this.selection);
    this.starLayer?.update(ctx);
    if (this.starLayer) this.deep.attachStarTemplate(this.starLayer);
    // Faint deep-sky light disappears into a bright sky.
    const skyVisibility = this.skyCtx ? smoothstep(2, 5.5, this.skyCtx.limitMag) : 1;
    this.deep.update(ctx, skyVisibility);
    this.systems.update(ctx, this.cameraPc(), this.mode === 'universe' && this.nav === 'orbit' ? this.orbitRig.target.id : null);
    if (now - this.lastHiddenRefresh > 2000) {
      // Star tiles stream in and out; keep the close-up star's catalogue point hidden.
      this.lastHiddenRefresh = now;
      this.systems.refreshHidden();
    }
    this.constellationLayer?.update(ctx);
    this.artLayer?.update(ctx, this.constellationLayer?.fade ?? 0);
    this.satelliteLayer?.update(ctx);
    this.ground.update(ctx);
    this.atmosphere.update(ctx);
    this.atmosphere.renderLut(this.renderer);
    if (!this.suspended) {
      this.draw(dt);
      this.labels.render(this.collectLabels());
    }

    this.trackPerformance(now, performance.now() - started);
    if (this.adaptive && !this.suspended && now > this.governorFrom && this.governor.update(dt, this.frameMs)) this.resize();
    if (now - this.lastStatsEmit > 200) {
      this.lastStatsEmit = now;
      this.emitStats(t);
    }
  };

  private draw(dt: number): void {
    this.updateLensFlare();
    this.renderer.info.reset();
    this.gpuTimer.begin();
    this.deep.renderVolumes(this.renderer, this.camera);
    this.composer.render(dt);
    this.gpuTimer.end();
    this.drawCalls = this.renderer.info.render.calls;
  }

  /** Flare strength: the Sun in (or just outside) the view, above the horizon, not behind a body, and bright. */
  private updateLensFlare(): void {
    const sun = this.flareOn ? this.solarLayer.views.find((v) => v.id === 'sun') : undefined;
    const p = sun?.shown && !this.belowHorizon(sun.rel) ? this.project(sun.rel, 1.4) : null;
    if (!sun || !p) {
      this.lensFlare.enabled = false;
      return;
    }
    const pos: [number, number] = [p[0] / this.width, 1 - p[1] / this.height];
    // Full strength for the Sun from the inner Solar System, gone by a few thousand AU.
    let k = Math.min(Math.max((-sun.magnitude - 10) / 16.7, 0), 1);
    k *= 1 - smoothstep(0.5, 0.85, Math.max(Math.abs(pos[0] - 0.5), Math.abs(pos[1] - 0.5)));
    const ppr = this.ctx.pixelsPerRadian;
    const sunAng = sun.radiusPx / ppr;
    for (const v of this.solarLayer.views) {
      if (v === sun || !v.shown || v.distance >= sun.distance) continue;
      const cos = (v.rel[0] * sun.rel[0] + v.rel[1] * sun.rel[1] + v.rel[2] * sun.rel[2]) / (v.distance * sun.distance);
      const sep = Math.acos(Math.min(1, Math.max(-1, cos)));
      const ang = v.radiusPx / ppr;
      k *= smoothstep(ang - sunAng, ang + sunAng, sep);
    }
    this.lensFlare.set(pos, k, this.width / this.height);
    this.lensFlare.enabled = k > 0.001;
  }

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
    this.systems.layer.setPhotometry(magRef, limit);
    this.smallBodies.setPhotometry(magRef, limit);
  }

  /**
   * Fly mode, every frame: measure the distance to the nearest object (solar
   * bodies, stars, galaxies) to scale speed, and re-anchor the camera to the
   * body whose sphere of influence it is in (else the Sun) so precision and
   * co-moving motion follow it.
   */
  private updateFlight(dt: number): void {
    const sunFrame = this.frames.require(SUN_FRAME_ID);
    let nearest = Infinity, nearestId = 'sun';
    let anchor = sunFrame, anchorSoi = Infinity;
    const origin: Vec3 = [0, 0, 0];
    for (const b of this.solar.bodies.values()) {
      const rel = this.frames.difference(this.flyRig.anchor, this.flyRig.offset, b.frame, origin, this.scratch);
      const d = Math.hypot(rel[0], rel[1], rel[2]);
      // Mean of equatorial and polar radii: the equatorial radius alone puts mid-latitude ground "inside" Earth.
      const surface = Math.max(d - (b.info.radius + b.info.polarRadius) / 2, 10);
      if (surface < nearest) {
        nearest = surface;
        nearestId = b.info.id;
      }
      if (b.info.id === 'sun' || isFittedMoon(b.info.id)) continue;
      // Sphere of influence: a (m/M)^(2/5) about the parent.
      const parent = this.solar.get(b.info.parent!)!;
      const a = Math.hypot(...this.frames.difference(parent.frame, origin, b.frame, origin));
      const soi = a * (b.info.mass / parent.info.mass) ** 0.4;
      if (d < soi && soi < anchorSoi) {
        anchor = b.frame;
        anchorSoi = soi;
      }
    }
    const camPc = this.cameraPc();
    const star = this.systems.nearestDistancePc * PC;
    if (star < nearest && this.systems.nearestStarKey) {
      nearest = star;
      nearestId = this.systems.nearestStarKey;
    }
    const galaxy = this.deep.nearestGalaxyDistance(camPc);
    if (galaxy < nearest) {
      nearest = galaxy;
      const fromSun = Math.hypot(...camPc) * PC;
      nearestId = fromSun < 30 * KPC ? 'galaxy' : fromSun < 2.5 * MPC ? 'local-group' : 'universe';
    }
    this.flyNearest = nearestId;
    // Smooth in log space, but react at once when something gets closer (no flying through it).
    const l = Math.log(Math.max(nearest, 1));
    this.flyRefLog = l < this.flyRefLog ? l : this.flyRefLog + (l - this.flyRefLog) * Math.min(1, dt * 3);
    this.flyRig.reference = Math.exp(this.flyRefLog);
    this.flyRig.reanchor(anchor, this.frames);
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
      const closeUp = sky ? undefined : this.systems.activeHyg;
      for (const n of this.starLabelNames) {
        if (n.i === closeUp) continue;
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

    if (!sky) items.push(...this.systems.labels((rel) => this.project(rel), free, placed));
    items.push(...this.smallBodies.labels(
      (rel) => this.project(rel), free, placed, this.magLimit, sky ? this.selection : this.orbitRig.target.id, (rel) => this.belowHorizon(rel),
    ));
    // Nebulae and galaxies fade into a bright sky (see skyVisibility in the frame loop): so do their labels.
    if (!this.skyCtx || this.skyCtx.limitMag > 3) {
      items.push(...this.deep.labels(
        (rel) => this.project(rel), free, placed, this.ctx.pixelsPerRadian, this.magLimit, (rel) => this.belowHorizon(rel),
      ));
    }

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
    if (key.startsWith('exo')) return this.systems.selectionRel(key, this.cameraPc(), [0, 0, 0]);
    if (key.startsWith('sb:')) return this.smallBodies.views.find((v) => v.key === key)?.rel ?? null;
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
    return this.selection ? this.infoFor(this.selection, t) : null;
  }

  /** Full topocentric description of any object (not just the selection), as seen from the observer. */
  describe(key: string): SelectionInfo | null {
    return this.infoFor(key.includes(':') || !this.solar.get(key) ? key : `body:${key}`, this.time.now());
  }

  private infoFor(key: string, t: AstroTime): SelectionInfo | null {
    const obs = this.skyCtx?.observer ?? observerState(this.ephemeris, t, this.geodetic);
    const precise = this.ephemeris.isPrecise(t.jdTdb);
    const conName = (raJ: number, decJ: number) => {
      if (!this.constellationData) return undefined;
      const id = constellationAt(this.constellationData, raJ / DEG, decJ / DEG);
      return id ? this.constellationData[id]?.name : undefined;
    };

    if (key.startsWith('body:')) {
      const id = key.slice(5);
      const info = findBody(id);
      if (!info) return null;
      if (id === 'earth') return null;
      const moon = isFittedMoon(id);
      const p = moon ? apparentMoon(this.ephemeris, obs, id) : apparentBody(this.ephemeris, obs, id as SolarBodyId);
      const ph = moon ? moonPhotometry(this.ephemeris, obs, id) : bodyPhotometry(this.ephemeris, obs, id as SolarBodyId);
      const details: [string, string][] = [];
      if (moon) details.push(['Moon of', findBody(info.parent!)!.name], ['Diameter', `${Math.round((info.radius * 2) / 1000).toLocaleString('en-US')} km`]);
      if (id !== 'sun') details.push(['Illuminated', `${(ph.illuminated * 100).toFixed(0)}%`]);
      return {
        key, kind: info.kind === 'star' ? 'star' : (info.kind as SelectionKind), name: info.name, details, travelable: true,
        constellation: conName(p.raJ2000, p.decJ2000),
        raJ2000: p.raJ2000, decJ2000: p.decJ2000, ra: p.ra, dec: p.dec, alt: p.altRefracted, az: p.horizontal.az,
        distance: p.distanceKm * 1000, magnitude: ph.magnitude, approximate: !precise,
        // A moon rises and sets with its planet (to within seconds).
        target: { kind: 'body', id: (moon ? info.parent! : id) as SolarBodyId },
      };
    }

    if (key.startsWith('sb:')) {
      const d = this.smallBodies.describe(key, this.ephemeris, obs);
      if (!d) return null;
      const p = d.place;
      const view = this.smallBodies.views.find((v) => v.key === key);
      const km = p.distanceKm;
      return {
        key, kind: d.body.kind === 'dwarf-planet' ? 'dwarf-planet' : 'small-body', name: d.name, subtitle: d.subtitle,
        details: d.details, travelable: true, constellation: conName(p.raJ2000, p.decJ2000),
        raJ2000: p.raJ2000, decJ2000: p.decJ2000, ra: p.ra, dec: p.dec, alt: p.altRefracted, az: p.horizontal.az,
        distance: d.distanceM, magnitude: this.mode === 'sky' ? view?.magnitude : undefined, approximate: d.approximate,
        // Rise and set: treat it as fixed for the night at its current position (it moves slowly).
        target: { kind: 'fixed', positionKm: [p.direction[0] * km + obs.position[0], p.direction[1] * km + obs.position[1], p.direction[2] * km + obs.position[2]] },
      };
    }

    if (key.startsWith('exo')) {
      const d = this.systems.describe(key, t.jdTdb);
      if (!d) return null;
      const p = apparentFixed(obs, d.positionKm);
      return {
        key, kind: d.kind, name: d.name, subtitle: d.subtitle, details: d.details, travelable: true,
        constellation: conName(p.raJ2000, p.decJ2000),
        raJ2000: p.raJ2000, decJ2000: p.decJ2000, ra: p.ra, dec: p.dec, alt: p.altRefracted, az: p.horizontal.az,
        distance: d.distanceM, magnitude: d.magnitude, approximate: d.approximate,
        target: { kind: 'fixed', positionKm: d.positionKm },
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
      const system = this.systems.systemForHyg(i);
      if (system) details.push(...this.systems.systemDetails(system));
      return {
        key, kind: 'star', name: (entry && starDisplayName(entry)) ?? `HYG star #${i}`, details, travelable: !unknownDistance,
        subtitle: system ? (system.planets.length > 1 ? 'Planetary system' : 'Star with a planet') : undefined,
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
        details: deep.details, travelable: deep.distanceM !== undefined,
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
    if (id.startsWith('body:')) id = id.slice(5);
    const body = this.solar.get(id);
    if (body) return body.info.name;
    const named = FOCUS_NAMES[id];
    if (named) return named;
    if (id.startsWith('star:')) {
      const n = this.starNames.get(Number(id.slice(5)));
      return (n && starDisplayName(n)) ?? `HYG star #${id.slice(5)}`;
    }
    if (id.startsWith('exo')) return this.systems.describe(id, this.ctx.time.jdTdb)?.name ?? id;
    if (id.startsWith('sb:')) return this.smallBodies.bodies[Number(id.slice(3))]?.name ?? id;
    return this.deep.describe(id)?.name ?? id;
  }

  private trackPerformance(now: number, cpuMs: number): void {
    this.cpuMs += (cpuMs - this.cpuMs) * 0.1;
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
    const fly = this.mode === 'universe' && this.nav === 'fly';
    const focusId = this.mode === 'sky' ? 'earth' : fly ? this.flyNearest : this.orbitRig.target.id;
    const focusFrame = this.mode === 'sky' ? this.solar.get('earth')!.frame : fly ? this.flyRig.anchor : this.orbitRig.target.frame;
    const distance = this.mode === 'sky' ? this.skyRig.altitude : fly ? this.flyRig.reference : this.orbitRig.distance;
    const warp = this.mode === 'universe' && !fly ? this.orbitRig.warpState : null;
    const origin: Vec3 = [0, 0, 0];
    const lengthTo = (id: string) => {
      const d = this.frames.difference(focusFrame, origin, this.solar.get(id)!.frame, origin);
      return Math.hypot(d[0], d[1], d[2]);
    };
    const stats: EngineStats = {
      mode: this.mode,
      fps: this.fps,
      frameMs: this.frameMs,
      cpuMs: this.cpuMs,
      gpuMs: this.gpuTimer.ms,
      drawCalls: this.drawCalls,
      renderScale: this.adaptive ? this.governor.scale : 1,
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
      nav: this.mode === 'universe' ? this.nav : 'orbit',
      warp: warp ? { name: this.warpName, ...warp } : null,
      flyFactor: this.flyRig.factor,
    };
    for (const cb of this.statsListeners) cb(stats);
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
