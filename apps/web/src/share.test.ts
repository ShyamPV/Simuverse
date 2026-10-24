import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare } from './share.ts';

describe('share links', () => {
  it('round-trips an orbit view with time, selection and location', () => {
    const hash = encodeShare(
      { mode: 'orbit', target: 'jupiter', az: 0.5, el: -0.2, dist: 2.345678e8, selection: 'io', timeMs: Date.UTC(2026, 9, 24, 9), rate: 100, paused: true },
      { latDeg: -36.8485, lonDeg: 174.7633, name: 'Auckland', tz: 'Pacific/Auckland' },
    );
    expect(hash).toMatch(/^#v=1&m=o&t=jupiter/);
    const back = decodeShare(hash)!;
    expect(back.view.mode).toBe('orbit');
    expect(back.view.target).toBe('jupiter');
    expect(back.view.az).toBeCloseTo(0.5, 4);
    expect(back.view.el).toBeCloseTo(-0.2, 4);
    expect(back.view.dist).toBeCloseTo(2.34568e8, -3);
    expect(back.view.selection).toBe('io');
    expect(back.view.timeMs).toBe(Date.UTC(2026, 9, 24, 9));
    expect(back.view.rate).toBe(100);
    expect(back.view.paused).toBe(true);
    expect(back.location).toEqual({ latDeg: -36.8485, lonDeg: 174.7633, name: 'Auckland', tz: 'Pacific/Auckland' });
  });

  it('keeps catalogue names with spaces and symbols intact', () => {
    const back = decodeShare(encodeShare({ mode: 'orbit', target: 'TRAPPIST-1 e', az: 0, el: 0, dist: 1e8, selection: 'NGC 1952' }))!;
    expect(back.view.target).toBe('TRAPPIST-1 e');
    expect(back.view.selection).toBe('NGC 1952');
  });

  it('omits time when following the real clock', () => {
    const hash = encodeShare({ mode: 'sky', az: 3, el: 0.4, fov: 70 });
    expect(hash).not.toContain('d=');
    const back = decodeShare(hash)!;
    expect(back.view.timeMs).toBeUndefined();
    expect(back.view.fov).toBe(70);
  });

  it('round-trips a fly-mode pose to sub-metre precision at planetary distances', () => {
    const pos: [number, number, number] = [1.234567891e9, -2.5e8, 3.3e7];
    const back = decodeShare(encodeShare({ mode: 'fly', target: 'saturn', pos, quat: [0.1, -0.2, 0.3, 0.927] }))!;
    expect(back.view.pos![0]).toBeCloseTo(1.234567891e9, -1);
    expect(back.view.quat![3]).toBeCloseTo(0.927, 5);
  });

  it('rejects other hashes and malformed links', () => {
    expect(decodeShare('')).toBeNull();
    expect(decodeShare('#section-2')).toBeNull();
    expect(decodeShare('#v=1&m=x')).toBeNull();
    expect(decodeShare('#v=1&m=f&c=1,2')).toBeNull();
    // A bad location is dropped, not fatal.
    expect(decodeShare('#v=1&m=o&t=mars&l=999,0')!.location).toBeUndefined();
  });
});
