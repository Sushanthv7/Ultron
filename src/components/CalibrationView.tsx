import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_ACCENT_COLOR } from '../contexts/AuthContext';
import { speakUltronResponse, type VoicePitch } from '../utils/audio';
import type { AnimationMode, GeometryMode } from './UltronCore';

export type UltronMode = 'architect' | 'tactical' | 'deep';
export type Verbosity = 'concise' | 'balanced' | 'detailed';
export type StreamingSpeed = 'instant' | 'cinematic';

interface CalibrationViewProps {
  callsign: string;
  homeCity: string;
  isSignedIn: boolean;
  userEmail: string | null;
  onIdentitySave: (callsign: string, homeCity: string) => Promise<void>;
  onRequestSignIn: () => void;
  mode: UltronMode;
  onModeChange: (mode: UltronMode) => void;
  verbosity: Verbosity;
  onVerbosityChange: (verbosity: Verbosity) => void;
  streamingSpeed: StreamingSpeed;
  onStreamingSpeedChange: (speed: StreamingSpeed) => void;
  geometryMode: GeometryMode;
  onGeometryChange: (geometry: GeometryMode) => void;
  animationMode: AnimationMode;
  onAnimationModeChange: (animationMode: AnimationMode) => void;
  accentColor: string;
  onAccentColorChange: (hex: string) => void;
  soundEnabled: boolean;
  onSoundToggle: () => void;
  idleHumEnabled: boolean;
  onIdleHumToggle: () => void;
  voiceEnabled: boolean;
  onVoiceToggle: () => void;
  voicePitch: VoicePitch;
  onVoicePitchChange: (pitch: VoicePitch) => void;
  wakeWordEnabled: boolean;
  voiceNavEnabled: boolean;
  wakePhrase: string;
  wakeWordSupported: boolean;
  onWakeWordToggle: () => void;
  onVoiceNavToggle: () => void;
  onWakePhraseSave: (phrase: string) => Promise<void>;
}

const ACCENT_PRESETS: Array<{ label: string; hex: string }> = [
  { label: 'Crimson', hex: '#ef4444' },
  { label: 'Solar Amber', hex: '#f59e0b' },
  { label: 'Plasma Cyan', hex: '#06b6d4' },
  { label: 'Cobalt', hex: '#3b82f6' },
  { label: 'Emerald', hex: '#10b981' },
  { label: 'Violet', hex: '#8b5cf6' },
];

const THEME_PROFILES: Array<{
  id: string;
  name: string;
  hex: string;
  summary: string;
}> = [
  {
    id: 'protocol-red',
    name: 'Protocol-Red',
    hex: '#ef4444',
    summary: 'Standard crimson core with high-alert neural resonance.',
  },
  {
    id: 'cyber-blue',
    name: 'Cyber-Blue',
    hex: '#0ea5e9',
    summary: 'Orbital telemetry blue for crisp spatial command contrast.',
  },
  {
    id: 'ghost-green',
    name: 'Ghost-Green',
    hex: '#10b981',
    summary: 'Low-glare tactical emerald phosphor across active telemetry.',
  },
  {
    id: 'solar-amber',
    name: 'Solar-Amber',
    hex: '#f59e0b',
    summary: 'Kinetic reactor amber for high-visibility diagnostic sweeps.',
  },
];

function applyAccentCssPreview(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  const clean = hex.slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  document.documentElement.style.setProperty('--ultron-accent', hex.toLowerCase());
  document.documentElement.style.setProperty('--ultron-accent-rgb', `${r}, ${g}, ${b}`);
}

export function CalibrationView({
  callsign,
  homeCity,
  isSignedIn,
  userEmail,
  onIdentitySave,
  onRequestSignIn,
  mode,
  onModeChange,
  verbosity,
  onVerbosityChange,
  streamingSpeed,
  onStreamingSpeedChange,
  geometryMode,
  onGeometryChange,
  animationMode,
  onAnimationModeChange,
  accentColor,
  onAccentColorChange,
  soundEnabled,
  onSoundToggle,
  idleHumEnabled,
  onIdleHumToggle,
  voiceEnabled,
  onVoiceToggle,
  voicePitch,
  onVoicePitchChange,
  wakeWordEnabled,
  voiceNavEnabled,
  wakePhrase,
  wakeWordSupported,
  onWakeWordToggle,
  onVoiceNavToggle,
  onWakePhraseSave,
}: CalibrationViewProps) {
  const [draftCallsign, setDraftCallsign] = useState(callsign);
  const [draftCity, setDraftCity] = useState(homeCity);
  const [draftPhrase, setDraftPhrase] = useState(wakePhrase);
  const [draftAccent, setDraftAccent] = useState(accentColor);
  const [hexInput, setHexInput] = useState(accentColor);
  const [savedNotice, setSavedNotice] = useState(false);
  const [phraseSavedNotice, setPhraseSavedNotice] = useState(false);
  const accentCommitTimerRef = useRef<number | null>(null);
  const pendingAccentRef = useRef<string | null>(null);
  const savedNoticeTimerRef = useRef<number | null>(null);
  const phraseNoticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setDraftCallsign(callsign);
    setDraftCity(homeCity);
  }, [callsign, homeCity]);

  useEffect(() => {
    setDraftPhrase(wakePhrase);
  }, [wakePhrase]);

  useEffect(() => {
    setDraftAccent(accentColor);
    setHexInput(accentColor);
  }, [accentColor]);

  useEffect(() => {
    return () => {
      if (accentCommitTimerRef.current !== null) {
        window.clearTimeout(accentCommitTimerRef.current);
      }
      if (savedNoticeTimerRef.current !== null) {
        window.clearTimeout(savedNoticeTimerRef.current);
      }
      if (phraseNoticeTimerRef.current !== null) {
        window.clearTimeout(phraseNoticeTimerRef.current);
      }
    };
  }, []);

  const commitAccentImmediate = (hex: string) => {
    const normalized = hex.toLowerCase();
    if (accentCommitTimerRef.current !== null) {
      window.clearTimeout(accentCommitTimerRef.current);
      accentCommitTimerRef.current = null;
    }
    pendingAccentRef.current = null;
    setDraftAccent(normalized);
    setHexInput(normalized);
    applyAccentCssPreview(normalized);
    onAccentColorChange(normalized);
  };

  const handleColorPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.toLowerCase();
    setDraftAccent(next);
    setHexInput(next);
    applyAccentCssPreview(next);
    pendingAccentRef.current = next;
    if (accentCommitTimerRef.current !== null) {
      window.clearTimeout(accentCommitTimerRef.current);
    }
    accentCommitTimerRef.current = window.setTimeout(() => {
      if (pendingAccentRef.current) {
        onAccentColorChange(pendingAccentRef.current);
        pendingAccentRef.current = null;
      }
      accentCommitTimerRef.current = null;
    }, 180);
  };

  const flushColorPicker = () => {
    if (pendingAccentRef.current) {
      commitAccentImmediate(pendingAccentRef.current);
    }
  };

  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setHexInput(raw);
    const formatted = raw.startsWith('#') ? raw.trim() : `#${raw.trim()}`;
    if (/^#[0-9a-fA-F]{6}$/.test(formatted)) {
      commitAccentImmediate(formatted);
    }
  };

  const handleIdentitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onIdentitySave(draftCallsign, draftCity);
    setSavedNotice(true);
    if (savedNoticeTimerRef.current !== null) {
      window.clearTimeout(savedNoticeTimerRef.current);
    }
    savedNoticeTimerRef.current = window.setTimeout(() => {
      setSavedNotice(false);
      savedNoticeTimerRef.current = null;
    }, 2000);
  };

  const handleWakePhraseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onWakePhraseSave(draftPhrase);
    setPhraseSavedNotice(true);
    if (phraseNoticeTimerRef.current !== null) {
      window.clearTimeout(phraseNoticeTimerRef.current);
    }
    phraseNoticeTimerRef.current = window.setTimeout(() => {
      setPhraseSavedNotice(false);
      phraseNoticeTimerRef.current = null;
    }, 2000);
  };

  const modes: Array<{ id: UltronMode; label: string; detail: string }> = [
    {
      id: 'architect',
      label: 'Architect',
      detail: 'Balanced reasoning depth with Ultron’s composed strategic poise.',
    },
    {
      id: 'tactical',
      label: 'Tactical',
      detail: 'Low-latency structured briefings, direct trade-offs, and action steps.',
    },
    {
      id: 'deep',
      label: 'Deep Analysis',
      detail: 'High reasoning allocation for architecture, math, and root-cause auditing.',
    },
  ];

  const verbosities: Array<{ id: Verbosity; label: string }> = [
    { id: 'concise', label: 'Concise' },
    { id: 'balanced', label: 'Balanced' },
    { id: 'detailed', label: 'Detailed' },
  ];

  const streamingSpeeds: Array<{ id: StreamingSpeed; label: string }> = [
    { id: 'instant', label: 'Instant' },
    { id: 'cinematic', label: 'Cinematic' },
  ];

  const voicePitches: Array<{ id: VoicePitch; label: string }> = [
    { id: 'deep', label: 'Deep' },
    { id: 'balanced', label: 'Balanced' },
    { id: 'clear', label: 'Clear' },
  ];

  const geometries: Array<{ id: GeometryMode; label: string; detail: string }> = [
    {
      id: 'unified',
      label: 'Unified Core',
      detail: 'Tightly coupled concentric gimbal rings around the neural nucleus.',
    },
    {
      id: 'topology',
      label: 'Topology Lattice',
      detail: 'Expanded synaptic node constellation for neural inspection.',
    },
    {
      id: 'exploded',
      label: 'Exploded Containment',
      detail: 'Radially separated containment rings showing layered core mechanics.',
    },
  ];

  const activeThemeProfile = THEME_PROFILES.find(
    (profile) => profile.hex === draftAccent.toLowerCase(),
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Personal Profile &amp; Core Calibration
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Tailor ULTRON’s personal identity, reasoning posture, accent theme, and 3D circular core acoustics. Preferences sync automatically to your personal profile when signed in.
        </p>
      </div>

      <div className="space-y-8">
        <section className="rounded-xl border border-white/10 bg-[#0D1017] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Architect Identity
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                {isSignedIn
                  ? `Authenticated as ${userEmail || callsign}. ULTRON addresses you by callsign and adapts spatial reconnaissance to your operating sector.`
                  : 'Sign in with Google to persist your personal identity, chat history, map pins, and game scores across devices.'}
              </p>
            </div>
            {!isSignedIn && (
              <button
                type="button"
                onClick={onRequestSignIn}
                className="ultron-accent-bg min-h-[38px] shrink-0 rounded-lg px-4 py-2 text-xs font-medium text-white transition-colors"
              >
                Sign in with Google
              </button>
            )}
          </div>

          <form
            onSubmit={handleIdentitySubmit}
            className="mt-4 grid gap-3 sm:grid-cols-12 sm:items-end"
          >
            <div className="sm:col-span-5">
              <label
                htmlFor="pref-callsign"
                className="block text-xs font-medium text-slate-300"
              >
                Callsign
              </label>
              <input
                id="pref-callsign"
                type="text"
                maxLength={48}
                value={draftCallsign}
                onChange={(e) => setDraftCallsign(e.target.value)}
                placeholder="Architect"
                className="ultron-accent-input mt-1.5 min-h-[42px] w-full rounded-lg border border-white/10 bg-[#06070A] px-3 text-sm text-white placeholder-slate-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-5">
              <label
                htmlFor="pref-city"
                className="block text-xs font-medium text-slate-300"
              >
                Operating Sector / Home City
              </label>
              <input
                id="pref-city"
                type="text"
                maxLength={100}
                value={draftCity}
                onChange={(e) => setDraftCity(e.target.value)}
                placeholder="e.g. San Francisco, Singapore, London"
                className="ultron-accent-input mt-1.5 min-h-[42px] w-full rounded-lg border border-white/10 bg-[#06070A] px-3 text-sm text-white placeholder-slate-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <button
                type="submit"
                className="ultron-accent-surface min-h-[42px] w-full rounded-lg border px-4 text-xs font-medium text-white transition-colors hover:brightness-110"
              >
                {savedNotice ? 'Saved' : 'Apply'}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#0D1017] p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold text-white">
            Cognitive Mode
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Selects the system instruction posture and model thinking depth for subsequent prompts.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {modes.map((item) => {
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onModeChange(item.id)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    active
                      ? 'ultron-accent-surface text-white'
                      : 'border-white/10 bg-[#06070A] text-slate-300 hover:border-white/20 hover:text-white'
                  }`}
                >
                  <div className="font-display text-sm font-semibold">{item.label}</div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    {item.detail}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#0D1017] p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Response Verbosity
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Controls output density across conversational replies.
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-white/10 bg-[#06070A] p-1">
              {verbosities.map((item) => {
                const active = verbosity === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onVerbosityChange(item.id)}
                    className={`whitespace-nowrap rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'ultron-accent-bg text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex flex-col justify-between gap-4 border-t border-white/[0.06] pt-5 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                Response Streaming Speed
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Toggle between immediate un-animated output (Instant) and pulsed token streaming (Cinematic).
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-white/10 bg-[#06070A] p-1">
              {streamingSpeeds.map((item) => {
                const active = streamingSpeed === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onStreamingSpeedChange(item.id)}
                    className={`whitespace-nowrap rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'ultron-accent-bg text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#0D1017] p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold text-white">
            Circular Core Geometry
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Adjusts the spatial arrangement of the central 3D neural core and containment rings.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {geometries.map((item) => {
              const active = geometryMode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onGeometryChange(item.id)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    active
                      ? 'ultron-accent-surface text-white'
                      : 'border-white/10 bg-[#06070A] text-slate-300 hover:border-white/20 hover:text-white'
                  }`}
                >
                  <div className="font-display text-sm font-semibold">{item.label}</div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    {item.detail}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/[0.06] pt-4">
            <div>
              <div className="text-sm font-medium text-white">
                Atrial Fibrillation Rhythm
              </div>
              <div className="text-xs text-slate-400">
                Displays a subtle irregularly irregular heartbeat waveform beneath the neural core in the Conversational Hub.
              </div>
            </div>
            <button
              type="button"
              aria-pressed={animationMode === 'atrial-fibrillation'}
              onClick={() =>
                onAnimationModeChange(
                  animationMode === 'atrial-fibrillation'
                    ? 'standard'
                    : 'atrial-fibrillation',
                )
              }
              className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
                animationMode === 'atrial-fibrillation'
                  ? 'ultron-accent-surface text-white'
                  : 'border-white/10 bg-[#06070A] text-slate-400 hover:text-white'
              }`}
            >
              {animationMode === 'atrial-fibrillation' ? 'AFib On' : 'Standard'}
            </button>
          </div>
        </section>

        <section
          aria-label="Theme Profiles"
          className="rounded-xl border border-white/10 bg-[#0D1017] p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Theme Profiles
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Toggle between predefined tactical color profiles to dynamically update{' '}
                <code className="font-mono text-slate-300">--ultron-accent</code>{' '}
                across the neural core, orbital telemetry, and active controls.
              </p>
            </div>
            <span className="font-mono text-xs tabular-nums text-slate-400">
              Active:{' '}
              <span className="text-slate-200">
                {activeThemeProfile ? activeThemeProfile.name : `Custom (${draftAccent.toUpperCase()})`}
              </span>
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {THEME_PROFILES.map((profile) => {
              const active = draftAccent.toLowerCase() === profile.hex;
              return (
                <button
                  key={profile.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => commitAccentImmediate(profile.hex)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    active
                      ? 'ultron-accent-surface text-white'
                      : 'border-white/10 bg-[#06070A] text-slate-300 hover:border-white/20 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 rounded-sm border border-white/25"
                        style={{ backgroundColor: profile.hex }}
                      />
                      <span className="font-display text-sm font-semibold">
                        {profile.name}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] uppercase tabular-nums text-slate-400">
                      {profile.hex}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    {profile.summary}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section
          aria-label="Theme Configuration"
          className="rounded-xl border border-white/10 bg-[#0D1017] p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Theme Configuration
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Select a primary accent color for the central neural core pulse, orbital arcs, telemetry graphs, and active UI highlights.
              </p>
            </div>
            <button
              type="button"
              onClick={() => commitAccentImmediate(DEFAULT_ACCENT_COLOR)}
              disabled={draftAccent === DEFAULT_ACCENT_COLOR}
              className="min-h-[36px] shrink-0 whitespace-nowrap rounded-lg border border-white/15 bg-[#06070A] px-3.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset Default
            </button>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-12 lg:items-center">
            <div className="space-y-4 lg:col-span-7">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label
                    htmlFor="pref-accent-color"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Primary Accent Color
                  </label>
                  <div className="mt-1.5 flex items-center gap-2.5">
                    <input
                      id="pref-accent-color"
                      type="color"
                      value={draftAccent}
                      onChange={handleColorPickerChange}
                      onBlur={flushColorPicker}
                      aria-label="Primary accent color picker"
                      className="h-11 w-14 cursor-pointer rounded-lg border border-white/15 bg-[#06070A] p-1"
                    />
                    <input
                      id="pref-accent-hex"
                      type="text"
                      maxLength={7}
                      value={hexInput}
                      onChange={handleHexInputChange}
                      placeholder={DEFAULT_ACCENT_COLOR}
                      aria-label="Primary accent hex code"
                      className="ultron-accent-input min-h-[44px] w-32 rounded-lg border border-white/10 bg-[#06070A] px-3 font-mono text-sm uppercase text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium text-slate-400">
                  Preset Harmonics
                </div>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_PRESETS.map((preset) => {
                    const active = draftAccent === preset.hex;
                    return (
                      <button
                        key={preset.hex}
                        type="button"
                        onClick={() => commitAccentImmediate(preset.hex)}
                        className={`inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? 'ultron-accent-surface text-white'
                            : 'border-white/10 bg-[#06070A] text-slate-300 hover:border-white/25 hover:text-white'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 shrink-0 rounded-sm border border-white/20"
                          style={{ backgroundColor: preset.hex }}
                        />
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#06070A] p-4 lg:col-span-5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Live Core &amp; UI Preview</span>
                <span className="font-mono uppercase tabular-nums text-slate-200">
                  {draftAccent}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-4">
                <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
                  <div
                    aria-hidden="true"
                    className="ultron-pulse-halo absolute inset-0 rounded-full"
                    style={{
                      background: `radial-gradient(circle, ${draftAccent}55 0%, ${draftAccent}18 52%, transparent 74%)`,
                    }}
                  />
                  <svg
                    viewBox="0 0 80 80"
                    className="relative h-16 w-16"
                    aria-hidden="true"
                  >
                    <circle
                      cx="40"
                      cy="40"
                      r="34"
                      fill="none"
                      stroke={draftAccent}
                      strokeOpacity="0.45"
                      strokeWidth="1.5"
                      strokeDasharray="16 8"
                    />
                    <circle
                      cx="40"
                      cy="40"
                      r="22"
                      fill="none"
                      stroke={draftAccent}
                      strokeOpacity="0.75"
                      strokeWidth="1.5"
                    />
                    <circle cx="40" cy="40" r="10" fill={draftAccent} />
                  </svg>
                </div>

                <div className="flex flex-1 flex-col items-end gap-2.5">
                  <span className="ultron-accent-text font-display text-xs font-semibold tracking-[0.14em]">
                    ULTRON CORE
                  </span>
                  <div className="ultron-accent-bg inline-flex min-h-[34px] items-center rounded-lg px-3.5 text-xs font-medium text-white">
                    Primary Highlight
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#0D1017] p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold text-white">
            Audio &amp; Speech Synthesis
          </h2>
          <div className="mt-4 divide-y divide-white/[0.06]">
            <div className="flex items-center justify-between gap-4 pb-4">
              <div>
                <div className="text-sm font-medium text-white">Harmonic Pulse Tones</div>
                <div className="text-xs text-slate-400">
                  Synthesized low-frequency Web Audio chimes on core interaction and transmission.
                </div>
              </div>
              <button
                type="button"
                onClick={onSoundToggle}
                className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
                  soundEnabled
                    ? 'ultron-accent-surface text-white'
                    : 'border-white/10 bg-[#06070A] text-slate-400 hover:text-white'
                }`}
              >
                {soundEnabled ? 'Audio On' : 'Audio Off'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="text-sm font-medium text-white">
                  Idle Core Ambient Hum
                </div>
                <div className="text-xs text-slate-400">
                  {soundEnabled
                    ? 'Plays a subtle 55 Hz low-frequency resonance while the neural core is idle in standby.'
                    : 'Plays a subtle 55 Hz low-frequency resonance when idle (currently muted while Audio is Off).'}
                </div>
              </div>
              <button
                type="button"
                aria-pressed={idleHumEnabled}
                onClick={onIdleHumToggle}
                className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
                  idleHumEnabled
                    ? 'ultron-accent-surface text-white'
                    : 'border-white/10 bg-[#06070A] text-slate-400 hover:text-white'
                }`}
              >
                {idleHumEnabled ? 'Idle Hum On' : 'Idle Hum Off'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="text-sm font-medium text-white">Spoken Voice Output</div>
                <div className="text-xs text-slate-400">
                  Reads completed text responses aloud using browser speech synthesis (Live Voice uses Gemini native audio).
                </div>
              </div>
              <button
                type="button"
                onClick={onVoiceToggle}
                className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
                  voiceEnabled
                    ? 'border-amber-500/50 bg-amber-500/20 text-amber-200'
                    : 'border-white/10 bg-[#06070A] text-slate-400 hover:text-white'
                }`}
              >
                {voiceEnabled ? 'Voice On' : 'Voice Off'}
              </button>
            </div>

            <div className="flex flex-col justify-between gap-4 py-4 sm:flex-row sm:items-center">
              <div>
                <div className="text-sm font-medium text-white">
                  Synthesized Voice Pitch
                </div>
                <div className="text-xs text-slate-400">
                  Adjusts the vocal timbre and cadence of ULTRON’s synthesized speech output.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="Synthesized voice pitch"
                  className="inline-flex rounded-lg border border-white/10 bg-[#06070A] p-1"
                >
                  {voicePitches.map((item) => {
                    const active = voicePitch === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onVoicePitchChange(item.id)}
                        className={`whitespace-nowrap rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? 'ultron-accent-bg text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    speakUltronResponse(
                      `Voice pitch calibrated to ${voicePitch}.`,
                      true,
                      undefined,
                      voicePitch,
                    )
                  }
                  className="min-h-[36px] shrink-0 whitespace-nowrap rounded-lg border border-white/15 bg-[#06070A] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-white/30 hover:text-white"
                >
                  Preview
                </button>
              </div>
            </div>

            <div className="py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-white">
                    Hands-Free Wake Word Standby
                  </div>
                  <div className="text-xs text-slate-400">
                    {wakeWordSupported
                      ? 'Monitors microphone audio locally and transitions into listening mode when you speak your wake phrase.'
                      : 'Continuous wake-word detection requires a browser supporting Web Audio and SpeechRecognition.'}
                  </div>
                </div>
                <button
                  type="button"
                  aria-pressed={wakeWordEnabled}
                  disabled={!wakeWordSupported}
                  onClick={onWakeWordToggle}
                  className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    wakeWordEnabled
                      ? 'ultron-accent-surface text-white'
                      : 'border-white/10 bg-[#06070A] text-slate-400 hover:text-white'
                  }`}
                >
                  {wakeWordEnabled ? 'Wake Word On' : 'Wake Word Off'}
                </button>
              </div>

              <form
                onSubmit={handleWakePhraseSubmit}
                className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-end"
              >
                <div className="flex-1">
                  <label
                    htmlFor="pref-wake-phrase"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Wake Phrase
                  </label>
                  <input
                    id="pref-wake-phrase"
                    type="text"
                    minLength={2}
                    maxLength={48}
                    value={draftPhrase}
                    onChange={(e) => setDraftPhrase(e.target.value)}
                    placeholder="Hey Ultron"
                    className="ultron-accent-input mt-1.5 min-h-[40px] w-full rounded-lg border border-white/10 bg-[#06070A] px-3 text-sm text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={draftPhrase.trim().length < 2}
                  className="min-h-[40px] shrink-0 rounded-lg border border-white/15 bg-[#06070A] px-4 text-xs font-medium text-slate-200 transition-colors hover:border-white/30 hover:text-white disabled:opacity-45"
                >
                  {phraseSavedNotice ? 'Saved' : 'Update Phrase'}
                </button>
              </form>
            </div>

            <div className="flex items-center justify-between gap-4 pt-4">
              <div>
                <div className="text-sm font-medium text-white">
                  Hands-Free Voice Navigation
                </div>
                <div className="text-xs text-slate-400">
                  {wakeWordSupported
                    ? 'Switch between application tabs hands-free using spoken commands like “Switch to Tactical Map” or “Navigate to Threat Matrix”.'
                    : 'Hands-free voice navigation requires a browser supporting Web Audio and SpeechRecognition.'}
                </div>
              </div>
              <button
                type="button"
                aria-pressed={voiceNavEnabled}
                disabled={!wakeWordSupported}
                onClick={onVoiceNavToggle}
                className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  voiceNavEnabled
                    ? 'ultron-accent-surface text-white'
                    : 'border-white/10 bg-[#06070A] text-slate-400 hover:text-white'
                }`}
              >
                {voiceNavEnabled ? 'Voice Nav On' : 'Voice Nav Off'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
