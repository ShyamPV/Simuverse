/** Simulated clock: real-time, paused, or scaled (forward/reverse) relative to wall time. */

import { type AstroTime, astroTimeFromUnixMs } from '@simuverse/astro';

/** Ephemerides used in milestone 1 are only meaningful within this span. */
export const MIN_SIM_MS = Date.UTC(1000, 0, 1);
export const MAX_SIM_MS = Date.UTC(3000, 0, 1);

export class TimeController {
  private baseSimMs: number;
  private baseWallMs: number;
  private _rate = 1;
  private _paused = false;
  private readonly listeners = new Set<() => void>();

  constructor(startMs = Date.now(), private readonly wallClock: () => number = () => performance.now()) {
    this.baseSimMs = startMs;
    this.baseWallMs = wallClock();
  }

  get rate(): number {
    return this._rate;
  }

  get paused(): boolean {
    return this._paused;
  }

  nowMs(): number {
    if (this._paused) return this.baseSimMs;
    const t = this.baseSimMs + (this.wallClock() - this.baseWallMs) * this._rate;
    return Math.min(MAX_SIM_MS, Math.max(MIN_SIM_MS, t));
  }

  now(): AstroTime {
    return astroTimeFromUnixMs(this.nowMs());
  }

  /** Called after any user-initiated change (rate, pause, jump). */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private rebase(): void {
    this.baseSimMs = this.nowMs();
    this.baseWallMs = this.wallClock();
  }

  setRate(rate: number): void {
    this.rebase();
    this._rate = rate;
    this.notify();
  }

  setPaused(paused: boolean): void {
    this.rebase();
    this._paused = paused;
    this.notify();
  }

  setTimeMs(ms: number): void {
    this.baseSimMs = Math.min(MAX_SIM_MS, Math.max(MIN_SIM_MS, ms));
    this.baseWallMs = this.wallClock();
    this.notify();
  }

  /** Jump to the real current time at normal speed. */
  resetToNow(): void {
    this.baseSimMs = Date.now();
    this.baseWallMs = this.wallClock();
    this._rate = 1;
    this._paused = false;
    this.notify();
  }
}
