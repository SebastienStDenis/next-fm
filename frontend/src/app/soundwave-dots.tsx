"use client";

import { useEffect, useRef } from "react";

// A grid of dots pushed outward by a sine wave keyed to each dot's distance
// from the center, so concentric ripples radiate out like sound waves from a
// point source. Deliberately quiet: it borrows the primary token at low opacity
// and sits behind the page content.
const GRID_GAP = 30;
const AMPLITUDE = 6;
const WAVELENGTH = 150;
const SPEED = 0.0016; // radians per ms

export function SoundwaveDots() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let color = "oklch(0.55 0.05 60)";

    const readColor = () => {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue("--primary")
        .trim();
      if (value) color = value;
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      const k = (2 * Math.PI) / WAVELENGTH;
      const cx = width / 2;
      const cy = height / 2;
      for (let gy = GRID_GAP / 2; gy < height; gy += GRID_GAP) {
        for (let gx = GRID_GAP / 2; gx < width; gx += GRID_GAP) {
          const dx = gx - cx;
          const dy = gy - cy;
          const dist = Math.hypot(dx, dy) || 1;
          const wave = Math.sin(k * dist - time * SPEED);
          const offset = (wave * AMPLITUDE) / dist;
          const x = gx + dx * offset;
          const y = gy + dy * offset;
          const radius = 1 + (wave + 1) * 0.6;
          ctx.globalAlpha = 0.05 + (wave + 1) * 0.05;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    let frame = 0;
    const loop = (time: number) => {
      draw(time);
      frame = requestAnimationFrame(loop);
    };

    readColor();
    resize();

    if (reduceMotion) {
      draw(0);
    } else {
      frame = requestAnimationFrame(loop);
    }

    window.addEventListener("resize", resize);
    const themeObserver = new MutationObserver(() => {
      readColor();
      if (reduceMotion) draw(0);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
