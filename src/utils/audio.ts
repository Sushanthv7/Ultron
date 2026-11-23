// Procedural Web Audio harmonic feedback, idle core hum & Web Speech API voice output for ULTRON

let audioCtx: AudioContext | null = null;

function getAudioContext(resumeIfSuspended = true): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (resumeIfSuspended && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

interface IdleHumNodes {
  subOsc: OscillatorNode;
  harmOsc: OscillatorNode;
  lfoOsc: OscillatorNode;
  harmGain: GainNode;
  lfoGain: GainNode;
  filter: BiquadFilterNode;
  masterGain: GainNode;
}

let idleHumDesired = false;
let idleHumNodes: IdleHumNodes | null = null;
let idleHumStopTimer: number | null = null;
let gestureListenerAttached = false;

function detachGestureUnlock() {
  if (!gestureListenerAttached || typeof window === 'undefined') return;
  gestureListenerAttached = false;
  window.removeEventListener('pointerdown', handleFirstUserGesture);
  window.removeEventListener('keydown', handleFirstUserGesture);
}

function handleFirstUserGesture() {
  detachGestureUnlock();
  if (idleHumDesired) {
    startOrResumeIdleHum();
  }
}

function attachGestureUnlock() {
  if (gestureListenerAttached || typeof window === 'undefined') return;
  gestureListenerAttached = true;
  window.addEventListener('pointerdown', handleFirstUserGesture, { passive: true });
  window.addEventListener('keydown', handleFirstUserGesture, { passive: true });
}

function teardownIdleHumNodes() {
  if (idleHumStopTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(idleHumStopTimer);
    idleHumStopTimer = null;
  }
  if (!idleHumNodes) return;
  const nodes = idleHumNodes;
  idleHumNodes = null;
  try {
    nodes.subOsc.stop();
    nodes.harmOsc.stop();
    nodes.lfoOsc.stop();
  } catch {
    // Oscillators may already be stopped
  }
  try {
    nodes.subOsc.disconnect();
    nodes.harmOsc.disconnect();
    nodes.lfoOsc.disconnect();
    nodes.harmGain.disconnect();
    nodes.lfoGain.disconnect();
    nodes.filter.disconnect();
    nodes.masterGain.disconnect();
  } catch {
    // Ignore disconnect errors
  }
}

function startOrResumeIdleHum() {
  const ctx = getAudioContext(true);
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    attachGestureUnlock();
    return;
  }

  detachGestureUnlock();

  if (idleHumStopTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(idleHumStopTimer);
    idleHumStopTimer = null;
  }

  const now = ctx.currentTime;

  if (idleHumNodes) {
    idleHumNodes.masterGain.gain.cancelScheduledValues(now);
    idleHumNodes.masterGain.gain.setTargetAtTime(0.032, now, 0.35);
    return;
  }

  try {
    const subOsc = ctx.createOscillator();
    const harmOsc = ctx.createOscillator();
    const lfoOsc = ctx.createOscillator();
    const harmGain = ctx.createGain();
    const lfoGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const masterGain = ctx.createGain();

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(55, now);

    harmOsc.type = 'triangle';
    harmOsc.frequency.setValueAtTime(110, now);
    harmGain.gain.setValueAtTime(0.18, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(145, now);
    filter.Q.setValueAtTime(1.4, now);

    lfoOsc.type = 'sine';
    lfoOsc.frequency.setValueAtTime(0.16, now);
    lfoGain.gain.setValueAtTime(30, now);

    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.setTargetAtTime(0.032, now, 0.4);

    lfoOsc.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    subOsc.connect(filter);
    harmOsc.connect(harmGain);
    harmGain.connect(filter);

    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    subOsc.start(now);
    harmOsc.start(now);
    lfoOsc.start(now);

    idleHumNodes = {
      subOsc,
      harmOsc,
      lfoOsc,
      harmGain,
      lfoGain,
      filter,
      masterGain,
    };
  } catch {
    teardownIdleHumNodes();
  }
}

export function setIdleCoreHumActive(active: boolean): void {
  idleHumDesired = active;

  if (active) {
    startOrResumeIdleHum();
    return;
  }

  detachGestureUnlock();
  if (!idleHumNodes || !audioCtx) return;

  try {
    const now = audioCtx.currentTime;
    idleHumNodes.masterGain.gain.cancelScheduledValues(now);
    idleHumNodes.masterGain.gain.setTargetAtTime(0.0001, now, 0.14);
  } catch {
    teardownIdleHumNodes();
    return;
  }

  if (typeof window !== 'undefined') {
    if (idleHumStopTimer !== null) {
      window.clearTimeout(idleHumStopTimer);
    }
    idleHumStopTimer = window.setTimeout(() => {
      if (!idleHumDesired) {
        teardownIdleHumNodes();
      }
    }, 650);
  }
}

export function previewIdleCoreHum(durationMs = 1100): void {
  const ctx = getAudioContext(true);
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const durSec = Math.max(0.5, durationMs / 1000);
    const subOsc = ctx.createOscillator();
    const harmOsc = ctx.createOscillator();
    const harmGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(55, now);

    harmOsc.type = 'triangle';
    harmOsc.frequency.setValueAtTime(110, now);
    harmGain.gain.setValueAtTime(0.18, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(145, now);
    filter.Q.setValueAtTime(1.4, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.036, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);

    subOsc.connect(filter);
    harmOsc.connect(harmGain);
    harmGain.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    subOsc.start(now);
    harmOsc.start(now);
    subOsc.stop(now + durSec + 0.05);
    harmOsc.stop(now + durSec + 0.05);
  } catch {
    // Audio playback is optional; ignore browser restriction errors.
  }
}

export function playPulseTone(
  kind: 'engage' | 'transmit' | 'complete' | 'alert',
  enabled: boolean,
): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const gain = ctx.createGain();

    if (kind === 'engage') {
      osc.type = 'sine';
      sub.type = 'triangle';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(165, now + 0.22);
      sub.frequency.setValueAtTime(55, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
    } else if (kind === 'transmit') {
      osc.type = 'triangle';
      sub.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.14);
      sub.frequency.setValueAtTime(110, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    } else if (kind === 'complete') {
      osc.type = 'sine';
      sub.type = 'sine';
      osc.frequency.setValueAtTime(293.66, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.28);
      sub.frequency.setValueAtTime(73.42, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.055, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    } else {
      osc.type = 'sawtooth';
      sub.type = 'sine';
      osc.frequency.setValueAtTime(130, now);
      osc.frequency.exponentialRampToValueAtTime(92, now + 0.25);
      sub.frequency.setValueAtTime(65, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    }

    osc.connect(gain);
    sub.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    sub.start(now);
    osc.stop(now + 0.45);
    sub.stop(now + 0.45);
  } catch {
    // Audio playback is optional; ignore browser restriction errors.
  }
}

let speechBoundaryEnergy = 0;
let speechLastBoundaryMs = 0;
let speechWordIndex = 0;

export function sampleSpeechSynthSpectrum(
  outBins: Float32Array,
  nowMs: number,
  speaking: boolean,
): void {
  if (!speaking) {
    outBins.fill(0);
    return;
  }

  const elapsedSinceBoundary = Math.max(0, nowMs - speechLastBoundaryMs);
  const boundaryDecay = Math.exp(-elapsedSinceBoundary / 210);
  const cadenceWave =
    0.26 +
    0.22 * Math.sin(nowMs * 0.011) +
    0.14 * Math.sin(nowMs * 0.023 + speechWordIndex * 0.9);
  const envelope = Math.min(
    1,
    Math.max(0.18, speechBoundaryEnergy * boundaryDecay + cadenceWave * 0.65),
  );

  for (let i = 0; i < outBins.length; i++) {
    const norm = i / Math.max(1, outBins.length - 1);
    // Vocal formant weighting (strongest in lower-mid bins, gentle roll-off on highs)
    const formantWeight = Math.exp(-Math.pow((norm - 0.28) / 0.42, 2));
    const harmonicRipple =
      0.62 +
      0.38 *
        Math.sin(
          nowMs * (0.009 + norm * 0.014) + i * 0.85 + speechWordIndex * 1.1,
        );
    outBins[i] = Math.min(1, Math.max(0.05, envelope * formantWeight * harmonicRipple));
  }
}

export function stopUltronSpeech(): void {
  speechBoundaryEnergy = 0;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Ignore speech synthesis errors.
  }
}

export type VoicePitch = 'deep' | 'balanced' | 'clear';

const VOICE_PITCH_SETTINGS: Record<VoicePitch, { pitch: number; rate: number }> = {
  deep: { pitch: 0.72, rate: 0.94 },
  balanced: { pitch: 0.95, rate: 0.98 },
  clear: { pitch: 1.15, rate: 1.02 },
};

export function speakUltronResponse(
  text: string,
  enabled: boolean,
  onSpeakingChange?: (speaking: boolean) => void,
  voicePitch: VoicePitch = 'deep',
): void {
  if (!enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    speechBoundaryEnergy = 0;
    onSpeakingChange?.(false);
    return;
  }

  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#*_~>\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);

  if (!cleaned) {
    speechBoundaryEnergy = 0;
    onSpeakingChange?.(false);
    return;
  }

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleaned);
    const profile = VOICE_PITCH_SETTINGS[voicePitch] ?? VOICE_PITCH_SETTINGS.deep;
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    utterance.volume = 0.9;

    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => /en[-_](GB|US)/i.test(v.lang) && /Daniel|Arthur|Ryan|Google UK English Male|Alex/i.test(v.name)) ||
      voices.find((v) => /en/i.test(v.lang));
    if (preferred) {
      utterance.voice = preferred;
    }

    utterance.onstart = () => {
      speechBoundaryEnergy = 0.72;
      speechLastBoundaryMs = performance.now();
      speechWordIndex = 0;
      onSpeakingChange?.(true);
    };
    utterance.onboundary = (event) => {
      speechWordIndex += 1;
      speechLastBoundaryMs = performance.now();
      const lenBoost = Math.min(0.4, ((event.charLength || 4) / 10) * 0.4);
      speechBoundaryEnergy = 0.58 + lenBoost;
    };
    utterance.onend = () => {
      speechBoundaryEnergy = 0;
      onSpeakingChange?.(false);
    };
    utterance.onerror = () => {
      speechBoundaryEnergy = 0;
      onSpeakingChange?.(false);
    };

    window.speechSynthesis.speak(utterance);
  } catch {
    speechBoundaryEnergy = 0;
    onSpeakingChange?.(false);
  }
}
