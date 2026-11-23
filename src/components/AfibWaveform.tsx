import React, { useEffect, useRef, useState } from 'react';
import type { CoreState } from './UltronCore';

interface AfibWaveformProps {
  accentColor?: string;
  coreState: CoreState;
  isSpeaking: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  const valid = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ef4444';
  return [
    parseInt(valid.slice(1, 3), 16),
    parseInt(valid.slice(3, 5), 16),
    parseInt(valid.slice(5, 7), 16),
  ];
}

function gaussian(x: number, center: number, width: number): number {
  const d = (x - center) / width;
  return Math.exp(-0.5 * d * d);
}

/**
 * Generates one normalized sample of an Atrial Fibrillation waveform:
 * - No P-wave
 * - Chaotic fine fibrillatory baseline (f-waves)
 * - Sharp QRS + gentle T-wave when a beat occurs
 */
function sampleAfibMorphology(
  beatElapsedMs: number,
  beatAmplitude: number,
  timeSec: number,
  noiseSeed: number,
): number {
  // Chaotic fibrillatory baseline undulations (~5-8 Hz multi-harmonic + subtle jitter)
  const fWave =
    Math.sin(timeSec * 31.4 + noiseSeed) * 0.032 +
    Math.sin(timeSec * 47.1 + noiseSeed * 1.7) * 0.024 +
    Math.sin(timeSec * 67.3 + noiseSeed * 0.4) * 0.015;

  // QRS complex + T wave centered around start of beat (0..280ms)
  const q = -0.14 * gaussian(beatElapsedMs, 38, 6);
  const r = 0.92 * gaussian(beatElapsedMs, 52, 7.5);
  const s = -0.24 * gaussian(beatElapsedMs, 68, 7);
  const t = 0.2 * gaussian(beatElapsedMs, 175, 28);

  return fWave + (q + r + s + t) * beatAmplitude;
}

export function AfibWaveform({
  accentColor = '#ef4444',
  coreState,
  isSpeaking,
}: AfibWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const accentRef = useRef(accentColor);
  const stateRef = useRef(coreState);
  const speakingRef = useRef(isSpeaking);

  const [telemetry, setTelemetry] = useState<{ bpm: number; rrMs: number }>({
    bpm: 84,
    rrMs: 714,
  });

  accentRef.current = accentColor;
  stateRef.current = coreState;
  speakingRef.current = isSpeaking;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const SAMPLE_COUNT = 240;
    const samples = new Float32Array(SAMPLE_COUNT);

    let nextRrMs = 460 + Math.random() * 520;
    let beatElapsedMs = nextRrMs - 80;
    let beatAmplitude = 0.78 + Math.random() * 0.22;
    let noiseSeed = Math.random() * 100;
    let lastTimestamp = performance.now();
    let sampleAccumulatorMs = 0;
    const STEP_MS = 16;

    // Pre-seed buffer with realistic initial irregular beats
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const tSec = i * 0.016;
      beatElapsedMs += STEP_MS;
      if (beatElapsedMs >= nextRrMs) {
        beatElapsedMs = 0;
        nextRrMs = Math.round(390 + Math.random() * 620);
        beatAmplitude = 0.74 + Math.random() * 0.26;
        noiseSeed = Math.random() * 100;
      }
      samples[i] = sampleAfibMorphology(beatElapsedMs, beatAmplitude, tSec, noiseSeed);
    }

    const renderFrame = (drawCursor: boolean) => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(240, Math.floor(rect.width || 340));
      const height = Math.max(36, Math.floor(rect.height || 44));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const [r, g, b] = hexToRgb(accentRef.current);
      const baselineY = height * 0.62;
      const ampScale = height * 0.48;

      // Subtle center baseline hairline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, baselineY);
      ctx.lineTo(width, baselineY);
      ctx.stroke();

      // Segmented waveform with soft horizontal fade-in/out and phosphor glow
      const segs = 12;
      const chunk = Math.floor(SAMPLE_COUNT / segs);

      for (let s = 0; s < segs; s++) {
        const startIdx = s * chunk;
        const endIdx = s === segs - 1 ? SAMPLE_COUNT - 1 : (s + 1) * chunk;
        const progress = (s + 0.5) / segs;
        const edgeFade = progress < 0.14 ? progress / 0.14 : 1;
        const alpha = (0.14 + progress * 0.68) * edgeFade;

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.45;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();

        for (let i = startIdx; i <= endIdx; i++) {
          const x = (i / (SAMPLE_COUNT - 1)) * (width - 8) + 2;
          const y = baselineY - samples[i] * ampScale;
          if (i === startIdx) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // Leading phosphor stylus dot
      if (drawCursor) {
        const lastX = width - 6;
        const lastY = baselineY - samples[SAMPLE_COUNT - 1] * ampScale;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 4.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (prefersReducedMotion) {
      renderFrame(false);
      return;
    }

    let rafId = 0;
    let disposed = false;

    const tick = (now: number) => {
      if (disposed) return;

      const dt = Math.min(60, Math.max(0, now - lastTimestamp));
      lastTimestamp = now;
      sampleAccumulatorMs += dt;

      const st = stateRef.current;
      const active =
        st === 'processing' || st === 'responding' || speakingRef.current;

      while (sampleAccumulatorMs >= STEP_MS) {
        sampleAccumulatorMs -= STEP_MS;
        beatElapsedMs += STEP_MS;

        if (beatElapsedMs >= nextRrMs) {
          beatElapsedMs = 0;
          const minRr = active ? 340 : 410;
          const spanRr = active ? 460 : 620;
          const irregularJitter = Math.random() < 0.22 ? -75 : 0;
          nextRrMs = Math.max(
            320,
            Math.round(minRr + Math.random() * spanRr + irregularJitter),
          );
          beatAmplitude = (active ? 0.82 : 0.7) + Math.random() * 0.24;
          noiseSeed = Math.random() * 100;
          const instantBpm = Math.round(60000 / nextRrMs);
          setTelemetry({ bpm: instantBpm, rrMs: nextRrMs });
        }

        // Shift ring buffer left
        samples.copyWithin(0, 1);
        samples[SAMPLE_COUNT - 1] = sampleAfibMorphology(
          beatElapsedMs,
          beatAmplitude,
          now * 0.001,
          noiseSeed,
        );
      }

      renderFrame(true);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      aria-label="Atrial fibrillation irregular heartbeat waveform"
      className="mt-1 flex w-full max-w-[360px] flex-col items-center"
    >
      <canvas
        ref={canvasRef}
        className="block h-11 w-full"
      />
      <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] tabular-nums text-slate-500">
        <span>AFib Rhythm</span>
        <span aria-hidden="true">·</span>
        <span>{telemetry.bpm} bpm</span>
        <span aria-hidden="true">·</span>
        <span>RR {telemetry.rrMs} ms</span>
      </div>
    </div>
  );
}
