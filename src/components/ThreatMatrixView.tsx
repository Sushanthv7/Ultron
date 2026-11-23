import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2, ShieldAlert } from 'lucide-react';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  PerformanceMetricsCard,
  classifyLatencyIntensity,
  computeHeatmapBounds,
} from './PerformanceMetricsCard';

export interface LatencyPoint {
  id: string;
  index: number;
  label: string;
  timestamp: string;
  latencyMs: number;
  source: 'Hub' | 'Matrix';
}

interface RiskVector {
  name: string;
  severity: 'Critical' | 'Elevated' | 'Moderate' | 'Low' | string;
  likelihoodPercent: number;
  failureMode: string;
  countermeasure: string;
}

interface ThreatAssessment {
  subjectTitle: string;
  executiveSummary: string;
  resilienceIndex: number;
  dominantBottleneck: string;
  vectors: RiskVector[];
  directive: string;
}

interface ThreatMatrixViewProps {
  onAnalysisStateChange: (running: boolean) => void;
  latencyHistory: LatencyPoint[];
  onRecordLatency: (latencyMs: number, source: 'Hub' | 'Matrix') => void;
  onLargePayloadReceived?: () => void;
  accentColor?: string;
}

const SAMPLE_TARGETS = [
  'Multi-region microservices payment gateway with eventual consistency',
  'Launching an AI developer CLI tool in a crowded open-source market',
  'Migrating a monolithic Postgres database to sharded edge replicas',
];

export function ThreatMatrixView({
  onAnalysisStateChange,
  latencyHistory,
  onRecordLatency,
  onLargePayloadReceived,
  accentColor = '#ef4444',
}: ThreatMatrixViewProps) {
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ThreatAssessment | null>(null);
  const [hoveredLatencyIndex, setHoveredLatencyIndex] = useState<number | null>(null);

  const latencyStats = useMemo(() => {
    if (latencyHistory.length === 0) {
      return {
        latest: null,
        avg: null,
        peak: null,
        bounds: { minMs: 0, midMs: 0, maxMs: 0 },
      };
    }
    const latest = latencyHistory[latencyHistory.length - 1].latencyMs;
    const values = latencyHistory.map((item) => item.latencyMs);
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = Math.round(sum / latencyHistory.length);
    const peak = Math.max(...values);
    const bounds = computeHeatmapBounds(values);
    return { latest, avg, peak, bounds };
  }, [latencyHistory]);

  const heatmapEntries = useMemo(() => {
    return latencyHistory.map((point, idx) => ({
      point,
      idx,
      intensity: classifyLatencyIntensity(
        point.latencyMs,
        latencyStats.bounds,
        accentColor,
      ),
    }));
  }, [latencyHistory, latencyStats.bounds, accentColor]);

  const activeHeatmapEntry =
    hoveredLatencyIndex !== null && heatmapEntries[hoveredLatencyIndex]
      ? heatmapEntries[hoveredLatencyIndex]
      : null;

  const runAnalysis = async (inputTarget?: string) => {
    const query = (inputTarget ?? target).trim();
    if (!query || loading) return;

    if (inputTarget) setTarget(inputTarget);
    setLoading(true);
    setError(null);
    onAnalysisStateChange(true);
    const startedAt = performance.now();

    try {
      const response = await fetch('/api/ultron/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: query }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Diagnostic analysis failed.');
      }

      onRecordLatency(Math.round(performance.now() - startedAt), 'Matrix');
      if (JSON.stringify(data).length >= 1000) {
        onLargePayloadReceived?.();
      }
      setResult(data as ThreatAssessment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete analysis.');
    } finally {
      setLoading(false);
      onAnalysisStateChange(false);
    }
  };

  const severityTone = (severity: string) => {
    if (/critical/i.test(severity)) return 'text-red-400';
    if (/elevated/i.test(severity)) return 'text-amber-400';
    if (/moderate/i.test(severity)) return 'text-slate-200';
    return 'text-emerald-400';
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Strategic Threat &amp; Architecture Matrix
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Submit any technical architecture, product strategy, or operational plan. ULTRON isolates structural bottlenecks, models failure vectors, and prescribes countermeasures.
        </p>
      </div>

      {/* Real-time Exchange Latency Sparkline */}
      <section
        aria-label="Exchange latency trend"
        className="mb-6 rounded-xl border border-white/10 bg-[#0D1017] p-4 sm:p-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 shrink-0 space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-display text-sm font-semibold text-white">
                Exchange Latency Trend
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {latencyHistory.length}{' '}
                {latencyHistory.length === 1 ? 'exchange' : 'exchanges'}
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-6">
              <div>
                <div className="text-[11px] text-slate-400">Latest</div>
                <div className="font-mono text-lg font-semibold tabular-nums text-white">
                  {latencyStats.latest !== null ? `${latencyStats.latest}` : '—'}
                  {latencyStats.latest !== null && (
                    <span className="ml-1 text-xs font-normal text-slate-400">ms</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Average</div>
                <div className="font-mono text-lg font-semibold tabular-nums text-amber-300">
                  {latencyStats.avg !== null ? `${latencyStats.avg}` : '—'}
                  {latencyStats.avg !== null && (
                    <span className="ml-1 text-xs font-normal text-slate-400">ms</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Peak</div>
                <div
                  className="font-mono text-lg font-semibold tabular-nums"
                  style={{ color: accentColor }}
                >
                  {latencyStats.peak !== null ? `${latencyStats.peak}` : '—'}
                  {latencyStats.peak !== null && (
                    <span className="ml-1 text-xs font-normal text-slate-400">ms</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="w-full lg:max-w-[480px]">
            {latencyHistory.length === 0 ? (
              <div className="flex h-[96px] items-center justify-center rounded-lg border border-white/[0.07] bg-[#06070A] px-4 text-center text-xs text-slate-400">
                Complete an exchange in the Conversational Hub or run an analysis below to plot live latency and heatmap intensity.
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="h-[78px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={latencyHistory}
                      margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
                      onMouseMove={(state) => {
                        if (
                          typeof state?.activeTooltipIndex === 'number' &&
                          state.activeTooltipIndex >= 0
                        ) {
                          setHoveredLatencyIndex(state.activeTooltipIndex);
                        }
                      }}
                      onMouseLeave={() => setHoveredLatencyIndex(null)}
                    >
                      <defs>
                        <linearGradient id="ultronLatencyFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={accentColor} stopOpacity={0.34} />
                          <stop offset="100%" stopColor={accentColor} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="label" hide />
                      <YAxis hide domain={[0, 'dataMax + 250']} />
                      {latencyStats.avg !== null && latencyHistory.length > 1 && (
                        <ReferenceLine
                          y={latencyStats.avg}
                          stroke="rgba(245, 158, 11, 0.35)"
                          strokeDasharray="3 3"
                        />
                      )}
                      <Tooltip
                        cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeWidth: 1 }}
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const point = payload[0].payload as LatencyPoint;
                          const intensity = classifyLatencyIntensity(
                            point.latencyMs,
                            latencyStats.bounds,
                            accentColor,
                          );
                          return (
                            <div className="rounded-lg border border-white/15 bg-[#06070A] px-3 py-2 text-xs shadow-lg">
                              <div className="text-slate-400">
                                {point.label} · {point.source} · {point.timestamp}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 font-mono font-semibold tabular-nums text-white">
                                <span>{point.latencyMs} ms</span>
                                <span aria-hidden="true" className="text-slate-600">
                                  ·
                                </span>
                                <span style={{ color: intensity.color }}>
                                  {intensity.tier}
                                </span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="latencyMs"
                        stroke={accentColor}
                        strokeWidth={2}
                        fill="url(#ultronLatencyFill)"
                        dot={(dotProps) => {
                          const { cx, cy, payload, index } = dotProps as {
                            cx?: number;
                            cy?: number;
                            payload?: LatencyPoint;
                            index?: number;
                          };
                          if (
                            typeof cx !== 'number' ||
                            typeof cy !== 'number' ||
                            !payload
                          ) {
                            return <g key={`empty-${index ?? 0}`} />;
                          }
                          const intensity = classifyLatencyIntensity(
                            payload.latencyMs,
                            latencyStats.bounds,
                            accentColor,
                          );
                          const isHighlighted = hoveredLatencyIndex === index;
                          const radius = isHighlighted
                            ? 4
                            : intensity.level >= 3
                              ? 3.25
                              : 2.25;
                          return (
                            <circle
                              key={`dot-${payload.id}`}
                              cx={cx}
                              cy={cy}
                              r={radius}
                              fill={intensity.color}
                              stroke={isHighlighted ? '#ffffff' : '#06070A'}
                              strokeWidth={isHighlighted ? 1.5 : 1}
                            />
                          );
                        }}
                        activeDot={{
                          r: 4,
                          fill: accentColor,
                          stroke: '#ffffff',
                          strokeWidth: 1.5,
                        }}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Synchronized Performance Heatmap Strip */}
                <div className="px-2">
                  <div
                    className="flex h-2.5 w-full items-stretch gap-px"
                    role="list"
                    aria-label="Latency spike heatmap strip"
                  >
                    {heatmapEntries.map(({ point, idx, intensity }) => {
                      const isActive = hoveredLatencyIndex === idx;
                      return (
                        <button
                          key={point.id}
                          type="button"
                          role="listitem"
                          onMouseEnter={() => setHoveredLatencyIndex(idx)}
                          onMouseLeave={() => setHoveredLatencyIndex(null)}
                          onFocus={() => setHoveredLatencyIndex(idx)}
                          onBlur={() => setHoveredLatencyIndex(null)}
                          aria-label={`${point.label} (${point.source}): ${point.latencyMs} ms, ${intensity.tier}`}
                          className="h-full min-w-[3px] flex-1 rounded-[1px] transition-opacity focus:outline-none"
                          style={{
                            backgroundColor: intensity.color,
                            opacity:
                              hoveredLatencyIndex === null || isActive ? 0.92 : 0.45,
                            boxShadow: isActive ? 'inset 0 0 0 1px #ffffff' : 'none',
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums text-slate-400">
                    <span>Performance Heatmap</span>
                    {activeHeatmapEntry ? (
                      <span>
                        {activeHeatmapEntry.point.label} ·{' '}
                        <strong className="font-normal text-slate-200">
                          {activeHeatmapEntry.point.latencyMs} ms
                        </strong>{' '}
                        ·{' '}
                        <strong
                          className="font-semibold"
                          style={{ color: activeHeatmapEntry.intensity.color }}
                        >
                          {activeHeatmapEntry.intensity.tier}
                        </strong>
                      </span>
                    ) : (
                      <span>
                        {latencyStats.bounds.minMs}–{latencyStats.bounds.maxMs} ms
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runAnalysis();
        }}
        className="rounded-xl border border-white/10 bg-[#0D1017] p-4 sm:p-5"
      >
        <label htmlFor="threat-target" className="block text-xs font-medium text-slate-300">
          Target System or Strategic Scenario
        </label>
        <div className="mt-2.5 flex flex-col gap-3 sm:flex-row">
          <input
            id="threat-target"
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Describe an architecture, product launch, or system constraint..."
            className="ultron-accent-input min-h-[44px] flex-1 rounded-lg border border-white/10 bg-[#06070A] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !target.trim()}
            className="ultron-accent-bg inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Evaluating</span>
              </>
            ) : (
              <>
                <span>Run Analysis</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
          <span>Presets:</span>
          {SAMPLE_TARGETS.map((preset, index) => (
            <button
              key={index}
              type="button"
              onClick={() => runAnalysis(preset)}
              className="text-left text-slate-300 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white hover:decoration-red-400"
            >
              {preset}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="mt-8 rounded-xl border border-white/10 bg-[#0D1017]/60 p-8 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-slate-500" />
          <p className="mt-3 text-sm font-medium text-slate-200">
            No active evaluation loaded
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Enter a target scenario above or select a preset to generate a structured vulnerability matrix.
          </p>
        </div>
      )}

      {loading && (
        <div className="mt-6 space-y-4">
          <div className="h-28 animate-pulse rounded-xl border border-white/10 bg-[#0D1017]" />
          <div className="h-56 animate-pulse rounded-xl border border-white/10 bg-[#0D1017]" />
        </div>
      )}

      {result && !loading && (
        <div className="mt-6 space-y-6">
          <section className="rounded-xl border border-white/10 bg-[#0D1017] p-5 sm:p-6">
            <div className="flex flex-col justify-between gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-end">
              <div>
                <div className="text-xs text-slate-400">
                  Evaluated Subject · Structural Assessment
                </div>
                <h2 className="mt-1 font-display text-xl font-semibold text-white">
                  {result.subjectTitle}
                </h2>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <div className="text-xs text-slate-400">Estimated Resilience</div>
                <div className="font-mono text-2xl font-semibold tabular-nums text-white">
                  {result.resilienceIndex}
                  <span className="ml-1 text-xs font-normal text-slate-400">/ 100</span>
                </div>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-slate-200">
              {result.executiveSummary}
            </p>

            <div className="mt-4 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2">
              <div>
                <div className="text-xs text-slate-400">Dominant Bottleneck</div>
                <p className="mt-1 text-sm font-medium text-amber-300">
                  {result.dominantBottleneck}
                </p>
              </div>
              <div>
                <div className="text-xs text-slate-400">Recommended Directive</div>
                <p className="mt-1 text-sm text-slate-200">{result.directive}</p>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0D1017]">
            <div className="border-b border-white/10 px-5 py-3.5">
              <h3 className="font-display text-base font-semibold text-white">
                Failure Vectors &amp; Countermeasures
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-slate-400">
                    <th className="px-5 py-3 font-medium">Vector</th>
                    <th className="px-4 py-3 font-medium">Severity</th>
                    <th className="px-4 py-3 text-right font-medium">Likelihood</th>
                    <th className="px-4 py-3 font-medium">Failure Mode</th>
                    <th className="px-5 py-3 font-medium">Countermeasure</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {result.vectors.map((vector, idx) => (
                    <tr key={idx} className="align-top transition-colors hover:bg-white/[0.02]">
                      <td className="px-5 py-3.5 font-medium text-white">
                        {vector.name}
                      </td>
                      <td className={`px-4 py-3.5 font-medium ${severityTone(vector.severity)}`}>
                        {vector.severity}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-200">
                        {vector.likelihoodPercent}%
                      </td>
                      <td className="px-4 py-3.5 text-slate-300">
                        {vector.failureMode}
                      </td>
                      <td className="px-5 py-3.5 text-slate-200">
                        {vector.countermeasure}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <PerformanceMetricsCard
        latencyHistory={latencyHistory}
        accentColor={accentColor}
      />
    </div>
  );
}
