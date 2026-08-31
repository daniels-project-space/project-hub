"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number; // 0..1 viewport fraction
  y: number;
  z: number; // 0 (far) .. 1 (near) — drives size, drift speed, parallax
  tw: number; // twinkle phase
  warm: boolean; // brass-tinted vs paper-white
};

const STAR_COUNT = 130;
const MAX_DPR = 2;

/**
 * Fixed full-viewport star canvas with genuine depth: near stars are larger,
 * drift faster, and parallax harder against scroll than far ones. Sits behind
 * the aurora layers in the fixed sky stack. Pauses when the tab is hidden and
 * renders a single static frame under prefers-reduced-motion.
 */
export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let raf = 0;
    let running = true;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const stars: Star[] = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: Math.pow(Math.random(), 1.6), // bias toward the far field
      tw: Math.random() * Math.PI * 2,
      warm: Math.random() < 0.22,
    }));

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // Read the live accent each resize-ish tick so accent switching recolors
    // the warm stars without a reload. Cheap: one getComputedStyle per frame
    // would be wasteful, so cache and refresh occasionally.
    let warmColor = "212, 165, 116";
    const refreshAccent = () => {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-brass")
        .trim();
      if (v) {
        // Render via a scratch element trick is overkill — draw with the CSS
        // color directly; canvas accepts any CSS color string.
        warmColor = v;
      }
    };
    refreshAccent();
    const accentTimer = window.setInterval(refreshAccent, 4000);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const scroll = window.scrollY;
      for (const s of stars) {
        // Slow upward-left drift, scaled by depth; wraps around.
        const drift = reduced ? 0 : t * 0.0000045 * (0.25 + s.z);
        const px = ((s.x - drift) % 1 + 1) % 1 * w;
        const parallax = scroll * (0.02 + s.z * 0.1);
        const py = (((s.y - drift * 0.6) % 1 + 1) % 1) * h - (parallax % (h + 40));
        const yy = py < -20 ? py + h + 40 : py;

        const size = 0.4 + s.z * 1.5;
        const twinkle = reduced
          ? 0.75
          : 0.55 + 0.45 * Math.sin(s.tw + t * 0.0011 * (0.4 + s.z));
        const alpha = (0.18 + s.z * 0.55) * twinkle;

        ctx.beginPath();
        ctx.arc(px, yy, size, 0, Math.PI * 2);
        if (s.warm) {
          ctx.fillStyle = warmColor;
          ctx.globalAlpha = alpha * 0.9;
        } else {
          ctx.fillStyle = "rgb(235, 238, 245)";
          ctx.globalAlpha = alpha;
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      if (!running) return;
      draw(t);
      if (reduced) return; // single static frame
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onVisibility = () => {
      running = !document.hidden;
      if (running && !reduced) raf = requestAnimationFrame(loop);
    };

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.clearInterval(accentTimer);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 w-full h-full opacity-70"
    />
  );
}
