/**
 * Owns the WebGL renderer, the frame graph, the camera rig and all layers,
 * and runs the render loop. The UI talks to it through this class only.
 */

import { AU, LY, PC, type Vec3, apparentMagnitude, type AstroTime } from '@simuverse/astro';
import { type StarNameEntry, loadStarCatalog, loadStarNames, starDisplayName } from '@simuverse/data';
import {
  ACESFilmicToneMapping, DepthTexture, FloatType, HalfFloatType, PerspectiveCamera, Quaternion, Scene,
  Vector2, Vector3, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FrameGraph } from './frames.ts';
import { type LabelItem, LabelLayer } from './LabelLayer.ts';
import { SolarSystemLayer } from './layers/SolarSystemLayer.ts';
import { StarLayer } from './layers/StarLayer.ts';
import type { RenderContext } from './layers/types.ts';
import { OrbitCameraRig, type OrbitTarget } from './OrbitCameraRig.ts';
import { SUN_FRAME_ID, SolarSystemModel } from './SolarSystemModel.ts';
import { TimeController } from './TimeController.ts';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type DepthMode = 'reversed-z' | 'logarithmic';

const QUALITY: Record<QualityPreset, { maxPixelRatio: number; msaa: number; bloom: boolean }> = {
  low: { maxPixelRatio: 1, msaa: 0, bloom: false },
  medium: { maxPixelRatio: 1.5, msaa: 2, bloom: true },
  high: { maxPixelRatio: 2, msaa: 4, bloom: true },
  ultra: { maxPixelRatio: 3, msaa: 8, bloom: true },
};

const STAR_MAG_REF = 5.5;
const STAR_MAG_LIMIT = 8.5;
const STAR_LABEL_MAG = 1.6;
const MAX_STAR_LABELS = 24;
const STAR_LABEL_CANDIDATES = 600;
const FAR_PLANE = 1e16;

export type ZoomLevel = 'planet' | 'solar-system' | 'stellar-neighbourhood';

export interface EngineStats {
  fps: number;
  frameMs: number;
  focusId: string;
  focusName: string;
  /** Camera → focus centre, metres. */
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
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** Element overlaying the canvas for DOM labels. */
  overlay: HTMLElement;
  dataBaseUrl: string;
  textureBaseUrl: string;
  quality?: QualityPreset;
  reducedMotion?: boolean;
  initialFocus?: string;
}

/** True if this browser exposes EXT_clip_control (needed for reversed-Z). */
function supportsReversedZ(): boolean {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return false;
  const ok = !!gl.getExtension('EXT_clip_control');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return ok;
}

export class Engine {
  readonly time = new TimeController();
  readonly frames = new FrameGraph('root');
  readonly solar: SolarSystemModel;
  readonly rig: OrbitCameraRig;
  readonly depthMode: DepthMode;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(50, 1, 1, FAR_PLANE);
  private composer!: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private readonly solarLayer: SolarSystemLayer;
  private starLayer: StarLayer | null = null;
  private starNames: StarNameEntry[] = [];
  private readonly labels: LabelLayer;
  private showLabels = true;

  private quality: QualityPreset;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private raf = 0;
  private lastFrame = performance.now();
  private readonly resizeObserver: ResizeObserver;
  private readonly statsListeners = new Set<(s: EngineStats) => void>();
  private readonly focusListeners = new Set<(id: string) => void>();
  private lastStatsEmit = 0;
  private fpsFrames = 0;
  private fpsStart = performance.now();
  private fps = 0;
  private frameMs = 0;
  private speed = 0;
  private readonly prevOffset: Vec3 = [0, 0, 0];
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
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x000000, 1);

    this.solar = new SolarSystemModel(this.frames);
    const t0 = this.time.now();
    this.frames.update(t0);
    this.solar.update(t0);

    const focusId = opts.initialFocus ?? 'earth';
    const focusTarget = this.targetFor(focusId);
    this.rig = new OrbitCameraRig(this.frames, focusTarget, focusTarget.radius * 3.2, opts.reducedMotion);
    this.pointAtSunlitSide(focusTarget);

    this.solarLayer = new SolarSystemLayer(
      this.solar, opts.textureBaseUrl, this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.solarLayer.setPhotometry(STAR_MAG_REF, STAR_MAG_LIMIT);
    this.scene.add(this.solarLayer.object);

    this.labels = new LabelLayer(opts.overlay, (key) => {
      if (key.startsWith('body:')) this.focus(key.slice(5));
    });

    this.ctx = {
      time: t0,
      frames: this.frames,
      rig: this.rig,
      camera: this.camera,
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
    const offInput = this.attachInput();
    this.detach = () => {
      offTime();
      offInput();
    };
    this.loadStars();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- public API

  onStats(cb: (s: EngineStats) => void): () => void {
    this.statsListeners.add(cb);
    return () => this.statsListeners.delete(cb);
  }

  onFocusChange(cb: (id: string) => void): () => void {
    this.focusListeners.add(cb);
    return () => this.focusListeners.delete(cb);
  }

  get focusId(): string {
    return this.rig.target.id;
  }

  focus(id: string): void {
    if (!this.solar.get(id)) return;
    const target = this.targetFor(id);
    const viewDistance = target.radius * (id === 'sun' ? 6 : id === 'saturn' ? 6 : 3.2);
    this.rig.focus(target, viewDistance);
    for (const cb of this.focusListeners) cb(id);
    // Don't make the UI wait for the next rendered frame (slow GPUs, background tabs).
    this.emitStats(this.ctx.time);
  }

  zoomToLevel(level: ZoomLevel): void {
    if (level === 'planet') {
      this.focus('earth');
      return;
    }
    if (this.rig.target.id !== 'sun') this.focus('sun');
    this.rig.zoomToDistance(level === 'solar-system' ? 70 * AU : 60 * LY);
  }

  setQuality(q: QualityPreset): void {
    if (q === this.quality) return;
    this.quality = q;
    this.buildComposer();
    this.resize();
  }

  setReducedMotion(v: boolean): void {
    this.rig.setReducedMotion(v);
  }

  setLabelsVisible(v: boolean): void {
    this.showLabels = v;
  }

  setOrbitsVisible(v: boolean): void {
    this.solarLayer.setOrbitsVisible(v);
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
    this.labels.dispose();
    this.solarLayer.dispose();
    this.starLayer?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- setup

  private targetFor(id: string): OrbitTarget {
    const b = this.solar.get(id)!;
    return { id, frame: b.frame, radius: b.info.radius };
  }

  /** Starts the camera between the Sun direction and the terminator, so the view opens on daylight. */
  private pointAtSunlitSide(target: OrbitTarget): void {
    const toSun = this.frames.difference(target.frame, [0, 0, 0], this.frames.require(SUN_FRAME_ID), [0, 0, 0]);
    this.rig.setAngles(Math.atan2(toSun[1], toSun[0]) + 0.75, 0.32);
  }

  private async loadStars(): Promise<void> {
    try {
      const [stars, names] = await Promise.all([
        loadStarCatalog(this.opts.dataBaseUrl),
        loadStarNames(this.opts.dataBaseUrl),
      ]);
      if (this.disposed) return;
      this.starNames = names.filter((n) => n.i < STAR_LABEL_CANDIDATES && starDisplayName(n));
      this.starLayer = new StarLayer(stars, this.frames.require(SUN_FRAME_ID), {
        magRef: STAR_MAG_REF,
        magLimit: STAR_MAG_LIMIT,
      });
      this.scene.add(this.starLayer.object);
    } catch (err) {
      console.error('Star catalogue failed to load', err);
    }
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
      this.rig.rotateBy(-dx * 0.005, dy * 0.005);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved < 4) this.pick(e.clientX, e.clientY);
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      this.rig.zoomBy(e.deltaY * scale * 0.0015);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const step = e.shiftKey ? 0.2 : 0.06;
      switch (e.key) {
        case 'ArrowLeft': this.rig.rotateBy(step, 0); break;
        case 'ArrowRight': this.rig.rotateBy(-step, 0); break;
        case 'ArrowUp': this.rig.rotateBy(0, step); break;
        case 'ArrowDown': this.rig.rotateBy(0, -step); break;
        case '+': case '=': case 'PageUp': this.rig.zoomBy(-0.35); break;
        case '-': case '_': case 'PageDown': this.rig.zoomBy(0.35); break;
        default: return;
      }
      e.preventDefault();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }

  /** Focuses the body under (or nearest within a few px of) a click. */
  private pick(clientX: number, clientY: number): void {
    const rect = this.opts.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    let best: { id: string; score: number } | null = null;
    for (const v of this.solarLayer.views) {
      const s = this.project(v.rel);
      if (!s) continue;
      const d = Math.hypot(s[0] - x, s[1] - y);
      const reach = Math.max(v.radiusPx, 10);
      if (d <= reach && (!best || d / reach < best.score)) best = { id: v.id, score: d / reach };
    }
    if (best && best.id !== this.rig.target.id) this.focus(best.id);
  }

  // ---------------------------------------------------------------- frame loop

  /** Camera-relative vector → CSS pixel position, or null if behind the camera. */
  private project(rel: Readonly<Vec3>): [number, number] | null {
    const len = Math.hypot(rel[0], rel[1], rel[2]) || 1;
    // Normalise first: projection only needs the direction, and this keeps
    // the math well-conditioned for objects light-years away.
    const v = this.v3.set(rel[0] / len, rel[1] / len, rel[2] / len).applyQuaternion(this.invCam);
    if (v.z >= -1e-6) return null;
    const p = this.camera.projectionMatrix.elements;
    const sx = (p[0]! * v.x) / -v.z;
    const sy = (p[5]! * v.y) / -v.z;
    if (Math.abs(sx) > 1.05 || Math.abs(sy) > 1.05) return null;
    return [(sx * 0.5 + 0.5) * this.width, (0.5 - sy * 0.5) * this.height];
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    const t: AstroTime = this.time.now();
    this.frames.update(t);
    this.solar.update(t);

    const prevAnchor = this.rig.anchor;
    this.prevOffset[0] = this.rig.offset[0];
    this.prevOffset[1] = this.rig.offset[1];
    this.prevOffset[2] = this.rig.offset[2];
    this.rig.update(dt);
    if (prevAnchor === this.rig.anchor && dt > 0) {
      const o = this.rig.offset;
      const inst = Math.hypot(o[0] - this.prevOffset[0], o[1] - this.prevOffset[1], o[2] - this.prevOffset[2]) / dt;
      this.speed += (inst - this.speed) * Math.min(1, dt * 8);
    }

    this.camera.quaternion.copy(this.rig.quaternion);
    // Near plane tracks altitude; float/reversed or log depth keeps the far plane cheap.
    this.camera.near = Math.min(Math.max(this.rig.altitude * 0.01, 0.5), 1e7);
    this.camera.far = FAR_PLANE;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.invCam.copy(this.camera.quaternion).invert();

    const ctx = this.ctx;
    ctx.time = t;
    ctx.width = this.width;
    ctx.height = this.height;
    ctx.pixelRatio = this.pixelRatio;
    ctx.pixelsPerRadian = this.height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);

    this.solarLayer.update(ctx);
    this.starLayer?.update(ctx);
    this.composer.render(dt);
    this.labels.render(this.showLabels ? this.collectLabels() : []);

    this.trackPerformance(now);
    if (now - this.lastStatsEmit > 200) {
      this.lastStatsEmit = now;
      this.emitStats(t);
    }
  };

  private collectLabels(): LabelItem[] {
    const items: LabelItem[] = [];
    const placed: [number, number][] = [];
    const free = (x: number, y: number) => placed.every(([px, py]) => Math.abs(px - x) > 70 || Math.abs(py - y) > 14);
    const views = this.solarLayer.views;
    const focusId = this.rig.target.id;
    // Focus first, then by apparent size (bigger wins collisions).
    const order = [...views].sort((a, b) =>
      a.id === focusId ? -1 : b.id === focusId ? 1 : b.radiusPx - a.radiusPx || a.distance - b.distance);

    for (const v of order) {
      if (v.radiusPx > Math.min(this.width, this.height) * 0.35) continue;
      const s = this.project(v.rel);
      if (!s || this.occluded(v.rel, v.distance, v.id)) continue;
      if (v.id !== focusId && !free(s[0], s[1])) continue;
      placed.push(s);
      items.push({
        key: `body:${v.id}`, text: v.name, kind: 'body', x: s[0], y: s[1],
        marker: v.radiusPx < 2.5, offset: Math.max(v.radiusPx, 3) + 6,
        color: this.solar.get(v.id)!.info.color, focused: v.id === focusId,
      });
    }

    if (this.starLayer) {
      const sunRel = this.ctx.toCamera(this.frames.require(SUN_FRAME_ID), [0, 0, 0], this.scratch);
      const pos = this.starLayer.stars.positions;
      const absMag = this.starLayer.stars.absMag;
      const camPc = [-sunRel[0] / PC, -sunRel[1] / PC, -sunRel[2] / PC];
      const rel: Vec3 = [0, 0, 0];
      let count = 0;
      for (const n of this.starNames) {
        rel[0] = pos[n.i * 3]! - camPc[0]!;
        rel[1] = pos[n.i * 3 + 1]! - camPc[1]!;
        rel[2] = pos[n.i * 3 + 2]! - camPc[2]!;
        const d = Math.hypot(rel[0], rel[1], rel[2]);
        if (apparentMagnitude(absMag[n.i]!, d) > STAR_LABEL_MAG) continue;
        const s = this.project(rel);
        if (!s || !free(s[0], s[1])) continue;
        if (this.occluded([rel[0] * PC, rel[1] * PC, rel[2] * PC], d * PC, '')) continue;
        placed.push(s);
        items.push({ key: `star:${n.i}`, text: starDisplayName(n)!, kind: 'star', x: s[0], y: s[1], marker: false, offset: 7 });
        if (++count >= MAX_STAR_LABELS) break;
      }
    }
    return items;
  }

  /** True if another body's disc lies between the camera and the given point. */
  private occluded(rel: Readonly<Vec3>, dist: number, selfId: string): boolean {
    const ux = rel[0] / dist, uy = rel[1] / dist, uz = rel[2] / dist;
    for (const o of this.solarLayer.views) {
      if (o.id === selfId || o.distance >= dist) continue;
      const along = o.rel[0] * ux + o.rel[1] * uy + o.rel[2] * uz;
      if (along <= 0) continue;
      const px = o.rel[0] - along * ux, py = o.rel[1] - along * uy, pz = o.rel[2] - along * uz;
      if (Math.hypot(px, py, pz) < this.solar.get(o.id)!.info.radius) return true;
    }
    return false;
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
    const target = this.solar.get(this.rig.target.id)!;
    const distance = this.rig.distance;
    const origin: Vec3 = [0, 0, 0];
    const lengthTo = (id: string) => {
      const d = this.frames.difference(target.frame, origin, this.solar.get(id)!.frame, origin);
      return Math.hypot(d[0], d[1], d[2]);
    };
    const stats: EngineStats = {
      fps: this.fps,
      frameMs: this.frameMs,
      focusId: target.info.id,
      focusName: target.info.name,
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
    };
    for (const cb of this.statsListeners) cb(stats);
  }
}
