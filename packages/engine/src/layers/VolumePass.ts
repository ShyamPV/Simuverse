/**
 * Reduced-resolution rendering for ray-marched volumes (the Milky Way model,
 * nebulae). Volumes render into an offscreen target holding (emitted light,
 * transmittance); one full-screen composite then applies
 *     final = volume.rgb + scene.rgb × volume.a
 * so glow adds and dust dims whatever lies behind. Half resolution quarters
 * the dominant cost; the soft volumes upsample without visible loss.
 */

import {
  CustomBlending, HalfFloatType, LinearFilter, Mesh, OneFactor, type PerspectiveCamera, PlaneGeometry, Scene,
  ShaderMaterial, SrcAlphaFactor, Vector2, type WebGLRenderer, WebGLRenderTarget, ZeroFactor,
} from 'three';

/** Blending for materials drawn into the volume target: light adds, transmittance multiplies. */
export const VOLUME_BLENDING = {
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: SrcAlphaFactor,
  blendSrcAlpha: ZeroFactor,
  blendDstAlpha: SrcAlphaFactor,
  transparent: true,
  depthTest: false,
  depthWrite: false,
} as const;

export class VolumePass {
  readonly scene = new Scene();
  readonly composite: Mesh;
  private readonly target = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false,
  });
  private readonly material: ShaderMaterial;
  private readonly size = new Vector2();
  /** Fraction of the drawing-buffer resolution the volumes are rendered at. */
  scale = 0.5;

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D uVolume;
        uniform vec2 uResolution;
        void main() { gl_FragColor = texture2D(uVolume, gl_FragCoord.xy / uResolution); }
      `,
      uniforms: { uVolume: { value: this.target.texture }, uResolution: { value: new Vector2(1, 1) } },
      ...VOLUME_BLENDING,
    });
    this.composite = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.composite.frustumCulled = false;
    this.composite.renderOrder = 30;
    this.composite.visible = false;
  }

  /** Renders visible volumes offscreen; call before the main scene render. */
  render(renderer: WebGLRenderer, camera: PerspectiveCamera): void {
    const any = this.scene.children.some((c) => c.visible);
    this.composite.visible = any;
    if (!any) return;
    renderer.getDrawingBufferSize(this.size);
    (this.material.uniforms.uResolution!.value as Vector2).copy(this.size);
    const w = Math.max(1, Math.round(this.size.x * this.scale)), h = Math.max(1, Math.round(this.size.y * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.setClearAlpha(1); // no light, full transmittance
    renderer.autoClear = true;
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevAlpha);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.composite.geometry.dispose();
  }
}
