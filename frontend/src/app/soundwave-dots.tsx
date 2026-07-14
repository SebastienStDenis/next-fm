"use client";

import { useEffect, useRef } from "react";

// A grid of dots kicked outward by expanding pulse rings that fire from the
// center at random times and random intensity, like a speaker cone thumping:
// each hit races outward fast, pushing and brightening the dots its wavefront
// passes, then fades. Deliberately quiet at rest: it borrows the primary token
// at low opacity and sits behind the page content.
const GRID_GAP = 20;
const BASE_ALPHA = 0.16;
const PULSE_SPEED = 0.425; // px per ms - the wavefront travels outward
const RING_SIGMA = 34; // wavefront thickness
const AMPLITUDE = 8; // outward dot displacement at full strength
const MIN_GAP = 240; // ms between pulses (min)
const GAP_JITTER = 900; // ms of extra random spacing

type Pulse = { start: number; intensity: number; ringRadius: number };

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
    let maxRadius = 0;
    let color = "oklch(0.55 0.05 60)";
    const pulses: Pulse[] = [];
    let nextSpawn = 0;

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
      maxRadius = Math.hypot(width, height) / 2;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawDots = () => {
      const cx = width / 2;
      const cy = height / 2;
      for (let gy = GRID_GAP / 2; gy < height; gy += GRID_GAP) {
        for (let gx = GRID_GAP / 2; gx < width; gx += GRID_GAP) {
          const dx = gx - cx;
          const dy = gy - cy;
          const dist = Math.hypot(dx, dy) || 1;
          let energy = 0;
          for (const pulse of pulses) {
            const ringRadius = pulse.ringRadius;
            const gap = dist - ringRadius;
            const env = Math.exp(
              -(gap * gap) / (2 * RING_SIGMA * RING_SIGMA),
            );
            const decay = Math.max(0, 1 - ringRadius / maxRadius);
            energy += pulse.intensity * env * decay;
          }
          if (energy > 1) energy = 1;
          const offset = (energy * AMPLITUDE) / dist;
          const x = gx + dx * offset;
          const y = gy + dy * offset;
          const radius = 1 + energy * 0.7;
          ctx.globalAlpha = BASE_ALPHA + energy * 0.14;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const draw = (time: number) => {
      if (time >= nextSpawn) {
        pulses.push({
          start: time,
          intensity: 0.55 + Math.random() * 0.95,
          ringRadius: 0,
        });
        nextSpawn = time + MIN_GAP + Math.random() * GAP_JITTER;
      }
      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        pulses[i].ringRadius = (time - pulses[i].start) * PULSE_SPEED;
        if (pulses[i].ringRadius - 3 * RING_SIGMA > maxRadius) {
          pulses.splice(i, 1);
        }
      }
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      drawDots();
    };

    let frame = 0;
    const loop = (time: number) => {
      draw(time);
      frame = requestAnimationFrame(loop);
    };

    readColor();
    resize();

    if (reduceMotion) {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      drawDots();
    } else {
      frame = requestAnimationFrame(loop);
    }

    window.addEventListener("resize", resize);
    const themeObserver = new MutationObserver(() => {
      readColor();
      if (reduceMotion) {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = color;
        drawDots();
      }
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
