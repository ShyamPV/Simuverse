import { useEffect, useRef } from 'react';
import { useApp } from '../state/store.ts';

/**
 * Animated starfield behind full-page (non-3D) views: a few hundred stars
 * twinkling and drifting slowly. Static when reduced motion is preferred.
 */
export function Starfield() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useApp((s) => s.reducedMotion());

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let raf = 0;
    const rand = (() => {
      let x = 0x2f6b9a1d;
      return () => ((x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909)) >>> 0) / 2 ** 32;
    })();
    const stars = Array.from({ length: 420 }, () => ({
      x: rand(), y: rand(), r: 0.3 + rand() ** 3 * 1.6, phase: rand() * Math.PI * 2, speed: 0.4 + rand() * 1.4,
      hue: rand() < 0.15 ? '255,214,170' : rand() < 0.3 ? '180,200,255' : '235,238,255',
    }));
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = (t: number) => {
      const w = c.clientWidth, h = c.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const tw = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(t / 1000 * s.speed + s.phase);
        const x = ((s.x + (reduced ? 0 : t / 4e6 * s.speed)) % 1) * w;
        ctx.fillStyle = `rgba(${s.hue},${(0.25 + 0.6 * tw).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw(0);
    });
    ro.observe(c);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduced]);

  return <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />;
}
