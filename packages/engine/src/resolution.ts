/**
 * Adaptive resolution: lowers the render scale when frames stay slow and
 * raises it again when there is headroom, to hold 60 fps on weaker GPUs.
 *
 * - Down: after 1.5 s below ~45 fps, by up to 0.25 at once (more for slower frames).
 * - Up: after `upWait` seconds at 60 fps, by 0.1. If that sends it straight back
 *   down, the next attempt waits twice as long (up to two minutes), so the
 *   resolution doesn't pump up and down.
 */
export class ResolutionGovernor {
  scale = 1;
  private slowFor = 0;
  private fastFor = 0;
  private upWait = 5;
  private sinceUp = Infinity;

  constructor(readonly min = 0.5) {}

  /** dt: seconds since the last frame; frameMs: recent average frame time. Returns true when the scale changed. */
  update(dt: number, frameMs: number): boolean {
    this.sinceUp += dt;
    if (frameMs > 22) {
      this.fastFor = 0;
      this.slowFor += dt;
      if (this.slowFor < 1.5 || this.scale <= this.min) return false;
      this.slowFor = 0;
      if (this.sinceUp < 3) this.upWait = Math.min(this.upWait * 2, 120);
      // Pixel count scales with scale², frame time roughly with pixel count.
      const target = this.scale * Math.sqrt(16.7 / frameMs);
      this.scale = round(Math.max(this.min, this.scale - 0.25, Math.min(this.scale - 0.05, target)));
      return true;
    }
    this.slowFor = 0;
    if (frameMs > 17.5 || this.scale >= 1) {
      this.fastFor = 0;
      return false;
    }
    this.fastFor += dt;
    if (this.fastFor < this.upWait) return false;
    this.fastFor = 0;
    this.sinceUp = 0;
    this.scale = round(Math.min(1, this.scale + 0.1));
    return true;
  }

  reset(): void {
    this.scale = 1;
    this.slowFor = this.fastFor = 0;
    this.upWait = 5;
    this.sinceUp = Infinity;
  }
}

const round = (x: number) => Math.round(x * 100) / 100;
