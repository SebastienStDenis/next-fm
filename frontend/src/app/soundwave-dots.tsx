"use client";

import { useEffect, useRef } from "react";

// A grid of dots kicked outward by expanding pulse rings, like a speaker cone
// thumping: each hit races outward fast, pushing and brightening the dots its
// wavefront passes, then fades. At rest the pulses fire from the center at
// random times and random intensity; while the visitor is clicking, each click
// fires its own pulse from the pointer and the automatic ones hold off.
// Deliberately quiet: it borrows the primary token at low opacity and sits
// behind the page content.
const GRID_GAP = 20;
const BASE_ALPHA = 0.16;
const PULSE_SPEED = 0.425; // px per ms - the wavefront travels outward
const RING_SIGMA = 34; // wavefront thickness
const AMPLITUDE = 8; // outward dot displacement at full strength
const MIN_GAP = 240; // ms between automatic pulses (min)
const GAP_JITTER = 900; // ms of extra random spacing
const CLICK_INTENSITY = 1.15;
const IDLE_RESUME = 2000; // ms of no clicks before automatic pulses return

type Pulse = {
  start: number;
  x: number;
  y: number;
  intensity: number;
  ringRadius: number;
  maxRadius: number;
};

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
    const pulses: Pulse[] = [];
    let nextSpawn = 0;
    let lastClick = Number.NEGATIVE_INFINITY;

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

    // How far a wavefront must travel to clear the viewport from where it fired,
    // so an off-center pulse fades over its own reach rather than the center's.
    const reachFrom = (x: number, y: number) =>
      Math.max(
        Math.hypot(x, y),
        Math.hypot(width - x, y),
        Math.hypot(x, height - y),
        Math.hypot(width - x, height - y),
      );

    const spawn = (time: number, x: number, y: number, intensity: number) => {
      pulses.push({
        start: time,
        x,
        y,
        intensity,
        ringRadius: 0,
        maxRadius: reachFrom(x, y) || 1,
      });
    };

    const drawDots = () => {
      for (let gy = GRID_GAP / 2; gy < height; gy += GRID_GAP) {
        for (let gx = GRID_GAP / 2; gx < width; gx += GRID_GAP) {
          let energy = 0;
          let pushX = 0;
          let pushY = 0;
          for (const pulse of pulses) {
            const dx = gx - pulse.x;
            const dy = gy - pulse.y;
            const dist = Math.hypot(dx, dy) || 1;
            const gap = dist - pulse.ringRadius;
            const env = Math.exp(-(gap * gap) / (2 * RING_SIGMA * RING_SIGMA));
            const decay = Math.max(0, 1 - pulse.ringRadius / pulse.maxRadius);
            const strength = pulse.intensity * env * decay;
            energy += strength;
            pushX += (dx / dist) * strength;
            pushY += (dy / dist) * strength;
          }
          if (energy > 1) energy = 1;
          const push = Math.hypot(pushX, pushY);
          const scale = push > 1 ? AMPLITUDE / push : AMPLITUDE;
          const x = gx + pushX * scale;
          const y = gy + pushY * scale;
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
        if (time - lastClick >= IDLE_RESUME) {
          spawn(time, width / 2, height / 2, 0.55 + Math.random() * 0.95);
        }
        nextSpawn = time + MIN_GAP + Math.random() * GAP_JITTER;
      }
      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        pulses[i].ringRadius = (time - pulses[i].start) * PULSE_SPEED;
        if (pulses[i].ringRadius - 3 * RING_SIGMA > pulses[i].maxRadius) {
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

    // Only bare page plays the field: the layout shells the dots show through
    // (each page's main and the root wrapper flanking it), and nothing else. A
    // click that lands on anything with content on it - text, a button, a
    // card - is ordinary UI and leaves the field alone.
    const isBackground = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === "MAIN" || "soundwaveBackground" in target.dataset);

    const handleClick = (event: MouseEvent) => {
      if (!isBackground(event.target)) return;
      const time = performance.now();
      lastClick = time;
      spawn(time, event.clientX, event.clientY, CLICK_INTENSITY);
    };

    // Thumping the field means double-clicking bare page, where the browser
    // would otherwise snap a highlight onto the nearest word. Only repeat
    // clicks on the background are suppressed, so all copy stays selectable.
    const handleMouseDown = (event: MouseEvent) => {
      if (event.detail > 1 && isBackground(event.target)) event.preventDefault();
    };

    const paintStill = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      drawDots();
    };

    readColor();
    resize();

    if (reduceMotion) {
      paintStill();
    } else {
      frame = requestAnimationFrame(loop);
      window.addEventListener("click", handleClick);
      window.addEventListener("mousedown", handleMouseDown);
    }

    window.addEventListener("resize", resize);
    const themeObserver = new MutationObserver(() => {
      readColor();
      if (reduceMotion) paintStill();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("click", handleClick);
      window.removeEventListener("mousedown", handleMouseDown);
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
