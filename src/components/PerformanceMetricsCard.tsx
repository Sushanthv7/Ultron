import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { LatencyPoint } from './ThreatMatrixView';

interface PerformanceMetricsCardProps {
  latencyHistory: LatencyPoint[];
  accentColor?: string;
}

export type HeatmapTier = 'Nominal' | 'Steady' | 'Moderate' | 'Elevated' | 'Spike';

export interface LatencyIntensity {
  level: 0 | 1 | 2 | 3 | 4;
  tier: HeatmapTier;
  color: string;
}

export interface HeatmapBounds {
  minMs: number;
  midMs: number;
  maxMs: number;
}

export function getHeatmapPalette(accentColor: string): readonly string[] {
  return ['#06b6d4', '#38bdf8', '#f59e0b', '#f97316', accentColor] as const;
}

export function computeHeatmapBounds(values: number[]): HeatmapBounds {
  if (values.length === 0) {
    return { minMs: 0, midMs: 0, maxMs: 0 };
  }
  const minMs = Math.min(...values);
  const maxMs = Math.max(...values);
  const midMs = Math.round((minMs + maxMs) / 2);
  return { minMs, midMs, maxMs };
}

export function classifyLatencyIntensity(
  sampleMs: number,
  bounds: HeatmapBounds,
  accentColor = '#ef4444',
): LatencyIntensity {
  const palette = getHeatmapPalette(accentColor);
  const span = bounds.maxMs - bounds.minMs;

  let level: 0 | 1 | 2 | 3 | 4;
  if (span < 40) {
    if (sampleMs < 450) level = 0;
    else if (sampleMs < 900) level = 1;
    else if (sampleMs < 1500) level = 2;
    else if (sampleMs < 2400) level = 3;
    else level = 4;
  } else {
    const norm = (sampleMs - bounds.minMs) / span;
    if (norm < 0.2) level = 0;
    else if (norm < 0.4) level = 1;
    else if (norm < 0.62) level = 2;
    else if (norm < 0.82) level = 3;
    else level = 4;
  }

  const tiers: readonly HeatmapTier[] = [
    'Nominal',
    'Steady',
    'Moderate',
    'Elevated',
    'Spike',
  ];

  return {
    level,
    tier: tiers[level],
    color: palette[level],
  };
}

interface SmoothedPoint {
  step: number;
  label: string;
  timestamp: string;
  source: 'Hub' | 'Matrix';
  sampleMs: number;
  avgMs: number;
  intensity: LatencyIntensity;
}

const CHART_HEIGHT = 216;
const HEATMAP_BAND_HEIGHT = 14;
const HEATMAP_GAP_TOP = 10;
const MARGIN = { top: 18, right: 16, bottom: 48, left: 48 };

export function PerformanceMetricsCard({
  latencyHistory,
  accentColor = '#ef4444',
}: PerformanceMetricsCardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(720);
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const nextWidth = Math.max(300, Math.floor(el.clientWidth));
      setChartWidth(nextWidth);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const heatmapBounds = useMemo(() => {
    const windowItems = latencyHistory.slice(-50);
    return computeHeatmapBounds(windowItems.map((item) => item.latencyMs));
  }, [latencyHistory]);

  const palette = useMemo(() => getHeatmapPalette(accentColor), [accentColor]);

  const series = useMemo<SmoothedPoint[]>(() => {
    const windowItems = latencyHistory.slice(-50);
    const rollingWindow = 5;

    return windowItems.map((item, idx) => {
      const start = Math.max(0, idx - rollingWindow + 1);
      const slice = windowItems.slice(start, idx + 1);
      const avgMs = Math.round(
        slice.reduce((sum, entry) => sum + entry.latencyMs, 0) / slice.length,
      );
      return {
        step: idx,
        label: item.label,
        timestamp: item.timestamp,
        source: item.source,
        sampleMs: item.latencyMs,
        avgMs,
        intensity: classifyLatencyIntensity(
          item.latencyMs,
          heatmapBounds,
          accentColor,
        ),
      };
    });
  }, [latencyHistory, heatmapBounds, accentColor]);

  const summary = useMemo(() => {
    if (series.length === 0) {
      return {
        meanMs: null,
        minMs: null,
        maxMs: null,
        deltaMs: null,
        spikeCount: 0,
      };
    }
    const avgValues = series.map((p) => p.avgMs);
    const rawValues = series.map((p) => p.sampleMs);
    const meanMs = Math.round(
      rawValues.reduce((acc, v) => acc + v, 0) / rawValues.length,
    );
    const minMs = Math.min(...avgValues);
    const maxMs = Math.max(...avgValues);
    const deltaMs =
      series.length >= 2
        ? series[series.length - 1].avgMs - series[0].avgMs
        : null;
    const spikeCount = series.filter((p) => p.intensity.level >= 3).length;
    return { meanMs, minMs, maxMs, deltaMs, spikeCount };
  }, [series]);

  const geometry = useMemo(() => {
    const innerWidth = Math.max(120, chartWidth - MARGIN.left - MARGIN.right);
    const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

    const maxPeak =
      d3.max(series, (d) => Math.max(d.avgMs, d.sampleMs)) ?? 500;
    const yMax = Math.max(200, Math.ceil((maxPeak * 1.15) / 100) * 100);

    const xScale = d3
      .scaleLinear()
      .domain([0, Math.max(1, series.length - 1)])
      .range([MARGIN.left, MARGIN.left + innerWidth]);

    const yScale = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([MARGIN.top + innerHeight, MARGIN.top]);

    const areaGenerator = d3
      .area<SmoothedPoint>()
      .x((d) => xScale(d.step))
      .y0(MARGIN.top + innerHeight)
      .y1((d) => yScale(d.avgMs))
      .curve(d3.curveMonotoneX);

    const lineGenerator = d3
      .line<SmoothedPoint>()
      .x((d) => xScale(d.step))
      .y((d) => yScale(d.avgMs))
      .curve(d3.curveMonotoneX);

    const areaPath = series.length > 0 ? areaGenerator(series) ?? '' : '';
    const linePath = series.length > 0 ? lineGenerator(series) ?? '' : '';
    const yTicks = yScale.ticks(3);

    const xTickIndices =
      series.length <= 1
        ? series.map((d) => d.step)
        : Array.from(
            new Set([
              0,
              Math.floor((series.length - 1) / 2),
              series.length - 1,
            ]),
          );

    const cellGap = 1;
    const count = Math.max(1, series.length);
    const rawSlotWidth = innerWidth / count;
    const cellWidth = Math.max(2, rawSlotWidth - cellGap);
    const heatmapY = MARGIN.top + innerHeight + HEATMAP_GAP_TOP;

    return {
      innerWidth,
      innerHeight,
      xScale,
      yScale,
      areaPath,
      linePath,
      yTicks,
      xTickIndices,
      cellWidth,
      rawSlotWidth,
      heatmapY,
    };
  }, [chartWidth, series]);

  const activePoint =
    hoveredStep !== null && series[hoveredStep]
      ? series[hoveredStep]
      : series.length > 0
        ? series[series.length - 1]
        : null;

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (series.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    // When pointer is inside the bottom heatmap strip, snap by uniform slot index
    if (relY >= geometry.heatmapY - 4) {
      const slotIdx = Math.floor((relX - MARGIN.left) / geometry.rawSlotWidth);
      const clamped = Math.max(0, Math.min(series.length - 1, slotIdx));
      setHoveredStep(clamped);
      return;
    }

    const rawStep = geometry.xScale.invert(relX);
    const clamped = Math.max(0, Math.min(series.length - 1, Math.round(rawStep)));
    setHoveredStep(clamped);
  };

  return (
    <section
      aria-label="Performance Metrics"
      className="mt-8 rounded-xl border border-white/10 bg-[#0D1017] p-5 sm:p-6"
    >
      <div className="flex flex-col justify-between gap-4 border-b border-white/10 pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Performance Metrics &amp; Spike Heatmap
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Smoothed rolling average latency and discrete spike intensity over the last 50 interactions
          </p>
        </div>

        <div className="flex flex-wrap items-baseline gap-6">
          <div>
            <div className="text-[11px] text-slate-400">Window</div>
            <div className="font-mono text-base font-semibold tabular-nums text-white">
              {series.length}
              <span className="ml-1 text-xs font-normal text-slate-400">/ 50</span>
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-400">Overall Mean</div>
            <div className="font-mono text-base font-semibold tabular-nums text-amber-300">
              {summary.meanMs !== null ? `${summary.meanMs}` : '—'}
              {summary.meanMs !== null && (
                <span className="ml-1 text-xs font-normal text-slate-400">ms</span>
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-400">Smoothed Range</div>
            <div className="font-mono text-base font-semibold tabular-nums text-slate-200">
              {summary.minMs !== null && summary.maxMs !== null
                ? `${summary.minMs}–${summary.maxMs}`
                : '—'}
              {summary.minMs !== null && (
                <span className="ml-1 text-xs font-normal text-slate-400">ms</span>
              )}
            </div>
          </div>

          {summary.deltaMs !== null && (
            <div>
              <div className="text-[11px] text-slate-400">Drift</div>
              <div
                className={`font-mono text-base font-semibold tabular-nums ${
                  summary.deltaMs <= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {summary.deltaMs > 0 ? `+${summary.deltaMs}` : `${summary.deltaMs}`}
                <span className="ml-1 text-xs font-normal text-slate-400">ms</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Interactive D3 Smoothed Area Chart + Synchronized Performance Heatmap */}
      <div ref={containerRef} className="mt-4 w-full">
        {series.length === 0 ? (
          <div className="flex h-[216px] items-center justify-center rounded-lg border border-white/[0.07] bg-[#06070A] px-6 text-center text-xs text-slate-400">
            No interaction telemetry captured yet. Complete exchanges in the Conversational Hub or run Threat Matrix evaluations to display smoothed latency trends and heatmap intensity.
          </div>
        ) : (
          <div>
            {/* Compact Live Crosshair Readout Bar */}
            {activePoint && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <div className="flex items-center gap-2 font-mono tabular-nums">
                  <span className="text-slate-200">{activePoint.label}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activePoint.source}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activePoint.timestamp}</span>
                </div>
                <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
                  <span>
                    Rolling Avg:{' '}
                    <strong
                      className="font-semibold"
                      style={{ color: accentColor }}
                    >
                      {activePoint.avgMs} ms
                    </strong>
                  </span>
                  <span>
                    Sample:{' '}
                    <strong className="font-semibold text-slate-200">
                      {activePoint.sampleMs} ms
                    </strong>
                  </span>
                  <span>
                    Intensity:{' '}
                    <strong
                      className="font-semibold"
                      style={{ color: activePoint.intensity.color }}
                    >
                      {activePoint.intensity.tier}
                    </strong>
                  </span>
                </div>
              </div>
            )}

            <svg
              width={chartWidth}
              height={CHART_HEIGHT}
              viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
              className="block w-full cursor-crosshair select-none overflow-visible"
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoveredStep(null)}
              role="img"
              aria-label="Smoothed area chart of rolling average latency with synchronized performance heatmap across the last 50 interactions"
            >
              <defs>
                <linearGradient id="d3AvgLatencyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentColor} stopOpacity={0.34} />
                  <stop offset="65%" stopColor="#f59e0b" stopOpacity={0.08} />
                  <stop offset="100%" stopColor={accentColor} stopOpacity={0.01} />
                </linearGradient>
              </defs>

              {/* Vertical Spike Intensity Bands inside Plot Area */}
              {series.map((pt) => {
                if (pt.intensity.level < 3) return null;
                const bandWidth = Math.max(4, Math.min(18, geometry.rawSlotWidth));
                const x =
                  series.length === 1
                    ? MARGIN.left
                    : Math.max(
                        MARGIN.left,
                        Math.min(
                          chartWidth - MARGIN.right - bandWidth,
                          geometry.xScale(pt.step) - bandWidth / 2,
                        ),
                      );
                return (
                  <rect
                    key={`band-${pt.step}`}
                    x={x}
                    y={MARGIN.top}
                    width={bandWidth}
                    height={geometry.innerHeight}
                    fill={pt.intensity.color}
                    fillOpacity={pt.intensity.level === 4 ? 0.14 : 0.08}
                  />
                );
              })}

              {/* Horizontal Gridlines & Y-Axis Labels */}
              {geometry.yTicks.map((tick) => {
                const y = geometry.yScale(tick);
                return (
                  <g key={tick}>
                    <line
                      x1={MARGIN.left}
                      x2={chartWidth - MARGIN.right}
                      y1={y}
                      y2={y}
                      stroke="rgba(255,255,255,0.07)"
                      strokeWidth={1}
                    />
                    <text
                      x={MARGIN.left - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-500 font-mono text-[10px] tabular-nums"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}

              {/* Overall Mean Reference Line */}
              {summary.meanMs !== null && series.length > 1 && (
                <line
                  x1={MARGIN.left}
                  x2={chartWidth - MARGIN.right}
                  y1={geometry.yScale(summary.meanMs)}
                  y2={geometry.yScale(summary.meanMs)}
                  stroke="rgba(245, 158, 11, 0.45)"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
              )}

              {/* D3 Smoothed Area Fill */}
              {series.length > 1 && (
                <path d={geometry.areaPath} fill="url(#d3AvgLatencyGradient)" />
              )}

              {/* D3 Smoothed Line Curve */}
              {series.length > 1 && (
                <path
                  d={geometry.linePath}
                  fill="none"
                  stroke={accentColor}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              )}

              {/* Raw Sample Spike Nodes Color-Coded by Intensity */}
              {series.map((pt) => {
                const cx = geometry.xScale(pt.step);
                const cy = geometry.yScale(pt.sampleMs);
                const isSpike = pt.intensity.level >= 3;
                const isModerate = pt.intensity.level === 2;
                if (!isSpike && !isModerate && series.length > 12) return null;
                return (
                  <g key={`sample-${pt.step}`}>
                    {isSpike && (
                      <line
                        x1={cx}
                        x2={cx}
                        y1={cy}
                        y2={MARGIN.top + geometry.innerHeight}
                        stroke={pt.intensity.color}
                        strokeOpacity={0.35}
                        strokeWidth={1}
                        strokeDasharray="2 2"
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={pt.intensity.level === 4 ? 3.5 : isSpike ? 3 : 2.25}
                      fill={pt.intensity.color}
                      stroke="#06070A"
                      strokeWidth={1}
                    />
                  </g>
                );
              })}

              {/* Performance Heatmap Band (1px-gapped discrete intensity cells) */}
              <g aria-label="Performance heatmap intensity cells">
                <text
                  x={MARGIN.left - 8}
                  y={geometry.heatmapY + HEATMAP_BAND_HEIGHT - 3}
                  textAnchor="end"
                  className="fill-slate-500 font-mono text-[9px] uppercase tracking-wider"
                >
                  Heat
                </text>
                {series.map((pt) => {
                  const cellX = MARGIN.left + pt.step * geometry.rawSlotWidth;
                  const isActive = activePoint?.step === pt.step;
                  return (
                    <rect
                      key={`heat-${pt.step}`}
                      x={cellX}
                      y={geometry.heatmapY}
                      width={geometry.cellWidth}
                      height={HEATMAP_BAND_HEIGHT}
                      rx={1.5}
                      fill={pt.intensity.color}
                      fillOpacity={isActive ? 1 : 0.78}
                      stroke={isActive ? '#ffffff' : 'transparent'}
                      strokeWidth={isActive ? 1 : 0}
                    />
                  );
                })}
              </g>

              {/* X-Axis Labels */}
              {geometry.xTickIndices.map((idx) => {
                const pt = series[idx];
                if (!pt) return null;
                return (
                  <text
                    key={idx}
                    x={geometry.xScale(idx)}
                    y={CHART_HEIGHT - 4}
                    textAnchor={
                      idx === 0
                        ? 'start'
                        : idx === series.length - 1
                          ? 'end'
                          : 'middle'
                    }
                    className="fill-slate-500 font-mono text-[10px] tabular-nums"
                  >
                    {pt.label}
                  </text>
                );
              })}

              {/* Active / Hovered Crosshair & Node */}
              {activePoint && (
                <g>
                  <line
                    x1={geometry.xScale(activePoint.step)}
                    x2={geometry.xScale(activePoint.step)}
                    y1={MARGIN.top}
                    y2={MARGIN.top + geometry.innerHeight}
                    stroke="rgba(255,255,255,0.22)"
                    strokeWidth={1}
                  />
                  <circle
                    cx={geometry.xScale(activePoint.step)}
                    cy={geometry.yScale(activePoint.avgMs)}
                    r={4.5}
                    fill={activePoint.intensity.color}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                </g>
              )}
            </svg>

            {/* Discrete Performance Heatmap Legend */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-3 text-[11px] text-slate-400">
              <div className="flex items-center gap-2 font-mono tabular-nums">
                <span className="text-slate-300">Performance Heatmap</span>
                <span aria-hidden="true">·</span>
                <span>
                  {summary.spikeCount}{' '}
                  {summary.spikeCount === 1 ? 'spike event' : 'spike events'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
                <div className="flex items-center gap-1.5">
                  <span>Nominal</span>
                  <div className="flex items-center gap-px" aria-hidden="true">
                    {palette.map((hex, i) => (
                      <span
                        key={i}
                        className="inline-block h-2.5 w-4 first:rounded-l-[2px] last:rounded-r-[2px]"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                  <span>Spike</span>
                </div>

                <span aria-hidden="true" className="text-slate-600">
                  |
                </span>

                <div className="flex items-center gap-3 text-slate-400">
                  <span>
                    Min{' '}
                    <strong className="font-normal text-slate-200">
                      {heatmapBounds.minMs} ms
                    </strong>
                  </span>
                  <span>
                    Mid{' '}
                    <strong className="font-normal text-slate-200">
                      {heatmapBounds.midMs} ms
                    </strong>
                  </span>
                  <span>
                    Max{' '}
                    <strong className="font-normal text-slate-200">
                      {heatmapBounds.maxMs} ms
                    </strong>
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

