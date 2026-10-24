/**
 * GPU time per frame from EXT_disjoint_timer_query_webgl2, where the browser
 * exposes it (Chrome and Edge on desktop; Firefox and Safari usually don't).
 * Queries resolve a few frames late, so a small ring of them is in flight.
 */
export class GpuTimer {
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private avg = 0;
  /** Smoothed milliseconds, or null when unsupported. */
  get ms(): number | null {
    return this.ext ? this.avg : null;
  }

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  begin(): void {
    if (!this.ext || this.active) return;
    this.poll();
    if (this.pending.length > 4) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll(): void {
    const gl = this.gl;
    while (this.pending.length) {
      const q = this.pending[0]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      // A disjoint event (clock change, context switch) invalidates the result.
      if (!gl.getParameter(this.ext!.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this.avg = this.avg ? this.avg + (ms - this.avg) * 0.1 : ms;
      }
      gl.deleteQuery(q);
    }
  }

  dispose(): void {
    for (const q of this.pending) this.gl.deleteQuery(q);
    this.pending.length = 0;
  }
}
