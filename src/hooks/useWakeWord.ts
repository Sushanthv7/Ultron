import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseVoiceNavigationCommand,
  type AppView,
} from '../utils/voiceNavigation';

export type WakeWordStatus = 'off' | 'arming' | 'armed' | 'paused' | 'error';

interface UseWakeWordOptions {
  enabled: boolean;
  voiceNavEnabled?: boolean;
  paused: boolean;
  wakePaused?: boolean;
  wakePhrase: string;
  onWakeDetected: (inlineCommand?: string) => void;
  onNavigateDetected?: (view: AppView) => void;
}

interface WakeRecognitionResultList {
  length: number;
  [index: number]: {
    isFinal: boolean;
    0: {
      transcript: string;
    };
  };
}

interface WakeRecognitionEvent {
  resultIndex: number;
  results: WakeRecognitionResultList;
}

interface WakeRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: WakeRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractWakeMatch(
  transcript: string,
  wakePhrase: string,
): { matched: boolean; trailing: string } {
  const normalizedPhrase = wakePhrase.trim().toLowerCase();
  const isDefaultUltron =
    !normalizedPhrase ||
    normalizedPhrase === 'hey ultron' ||
    normalizedPhrase === 'ultron';

  const pattern = isDefaultUltron
    ? /\b(?:hey|ok|okay)?\s*(?:ultron|altron|altran|oltron|ultra\s*on)\b[\s,.:!?-]*/i
    : new RegExp(`\\b${escapeRegex(normalizedPhrase)}\\b[\\s,.:!?-]*`, 'i');

  const match = pattern.exec(transcript);
  if (!match) {
    return { matched: false, trailing: '' };
  }
  const trailing = transcript.slice(match.index + match[0].length).trim();
  return { matched: true, trailing };
}

export function useWakeWord({
  enabled,
  voiceNavEnabled = false,
  paused,
  wakePaused = false,
  wakePhrase,
  onWakeDetected,
  onNavigateDetected,
}: UseWakeWordOptions) {
  const [status, setStatus] = useState<WakeWordStatus>('off');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<WakeRecognitionInstance | null>(null);
  const rafRef = useRef<number>(0);
  const restartTimerRef = useRef<number>(0);
  const settleTimerRef = useRef<number>(0);
  const navSettleTimerRef = useRef<number>(0);
  const lastTriggerAtRef = useRef<number>(0);
  const lastNavAtRef = useRef<number>(0);
  const activeRef = useRef<boolean>(false);

  const wakeEnabledRef = useRef(enabled);
  wakeEnabledRef.current = enabled;

  const voiceNavEnabledRef = useRef(voiceNavEnabled);
  voiceNavEnabledRef.current = voiceNavEnabled;

  const wakePausedRef = useRef(wakePaused);
  wakePausedRef.current = wakePaused;

  const wakePhraseRef = useRef(wakePhrase);
  wakePhraseRef.current = wakePhrase;

  const onWakeDetectedRef = useRef(onWakeDetected);
  onWakeDetectedRef.current = onWakeDetected;

  const onNavigateDetectedRef = useRef(onNavigateDetected);
  onNavigateDetectedRef.current = onNavigateDetected;

  const supported =
    typeof window !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    Boolean(
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown })
          .webkitSpeechRecognition,
    );

  const teardown = useCallback(() => {
    activeRef.current = false;
    window.clearTimeout(restartTimerRef.current);
    window.clearTimeout(settleTimerRef.current);
    window.clearTimeout(navSettleTimerRef.current);
    cancelAnimationFrame(rafRef.current);

    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      try {
        if (typeof recognitionRef.current.abort === 'function') {
          recognitionRef.current.abort();
        } else {
          recognitionRef.current.stop();
        }
      } catch {
        // Ignore stop/abort errors
      }
      recognitionRef.current = null;
    }

    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) {
        track.stop();
      }
      micStreamRef.current = null;
    }

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  const anyListeningFeatureEnabled = enabled || voiceNavEnabled;
  const effectivePaused =
    paused || (!voiceNavEnabled && wakePaused);

  useEffect(() => {
    if (!anyListeningFeatureEnabled) {
      teardown();
      setError(null);
      setStatus('off');
      return;
    }

    if (effectivePaused) {
      teardown();
      setStatus('paused');
      return;
    }

    if (!supported) {
      setError(
        'Hands-free voice features require browser SpeechRecognition and microphone audio access.',
      );
      setStatus('error');
      return;
    }

    let cancelled = false;
    activeRef.current = true;
    setError(null);
    setStatus('arming');

    const startWakeMonitor = async () => {
      try {
        // 1. Web Audio API microphone stream + AnalyserNode energy monitor
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (cancelled || !activeRef.current) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        micStreamRef.current = stream;

        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const audioCtx = new Ctx();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume().catch(() => {});
        }
        audioCtxRef.current = audioCtx;

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.7;
        source.connect(analyser);
        analyserRef.current = analyser;

        const sampleBuffer = new Float32Array(analyser.fftSize);
        let lastUiTick = 0;

        const measureEnergy = (now: number) => {
          if (cancelled || !activeRef.current || !analyserRef.current) return;
          if (now - lastUiTick > 90) {
            analyserRef.current.getFloatTimeDomainData(sampleBuffer);
            let sumSq = 0;
            for (let i = 0; i < sampleBuffer.length; i++) {
              sumSq += sampleBuffer[i] * sampleBuffer[i];
            }
            const rms = Math.sqrt(sumSq / sampleBuffer.length);
            const normalized = Math.min(1, rms * 8.5);
            setAudioLevel(normalized);
            lastUiTick = now;
          }
          rafRef.current = requestAnimationFrame(measureEnergy);
        };
        rafRef.current = requestAnimationFrame(measureEnergy);

        // 2. Continuous Web Speech Recognition loop scanning for navigation & wake phrases
        const Ctor =
          (
            window as unknown as {
              SpeechRecognition?: new () => WakeRecognitionInstance;
            }
          ).SpeechRecognition ||
          (
            window as unknown as {
              webkitSpeechRecognition?: new () => WakeRecognitionInstance;
            }
          ).webkitSpeechRecognition;

        if (!Ctor) return;

        const launchRecognition = () => {
          if (cancelled || !activeRef.current) return;
          const recognition = new Ctor();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';
          recognitionRef.current = recognition;

          const fireNavigate = (view: AppView) => {
            const nowMs = Date.now();
            if (nowMs - lastNavAtRef.current < 1600) return;
            lastNavAtRef.current = nowMs;
            window.clearTimeout(navSettleTimerRef.current);
            window.clearTimeout(settleTimerRef.current);
            onNavigateDetectedRef.current?.(view);
          };

          const fireWake = (inlineCommand?: string) => {
            const nowMs = Date.now();
            if (nowMs - lastTriggerAtRef.current < 2200) return;
            lastTriggerAtRef.current = nowMs;
            window.clearTimeout(settleTimerRef.current);
            window.clearTimeout(navSettleTimerRef.current);
            teardown();
            onWakeDetectedRef.current(
              inlineCommand && inlineCommand.length > 0
                ? inlineCommand
                : undefined,
            );
          };

          recognition.onresult = (event) => {
            if (cancelled || !activeRef.current) return;
            let combined = '';
            let hasFinal = false;

            for (let i = event.resultIndex; i < event.results.length; i++) {
              const res = event.results[i];
              combined += `${res[0]?.transcript ?? ''} `;
              if (res.isFinal) hasFinal = true;
            }

            const cleanedTranscript = combined.trim();

            if (voiceNavEnabledRef.current) {
              const navTarget = parseVoiceNavigationCommand(cleanedTranscript);
              if (navTarget) {
                if (hasFinal) {
                  fireNavigate(navTarget);
                  return;
                }
                window.clearTimeout(navSettleTimerRef.current);
                navSettleTimerRef.current = window.setTimeout(() => {
                  if (cancelled || !activeRef.current) return;
                  fireNavigate(navTarget);
                }, 380);
                return;
              }
            }

            if (!wakeEnabledRef.current || wakePausedRef.current) {
              return;
            }

            const { matched, trailing } = extractWakeMatch(
              cleanedTranscript,
              wakePhraseRef.current,
            );
            if (!matched) return;

            if (hasFinal) {
              fireWake(trailing);
              return;
            }

            // Wait briefly for inline command completion before transitioning to active listening
            window.clearTimeout(settleTimerRef.current);
            settleTimerRef.current = window.setTimeout(() => {
              if (cancelled || !activeRef.current) return;
              fireWake(trailing);
            }, trailing.length > 0 ? 750 : 420);
          };

          recognition.onerror = (ev) => {
            if (cancelled || !activeRef.current) return;
            const errCode = ev.error || '';
            if (
              errCode === 'not-allowed' ||
              errCode === 'service-not-allowed' ||
              errCode === 'audio-capture'
            ) {
              setError(
                'Microphone permission is required for hands-free voice control.',
              );
              setStatus('error');
              teardown();
            }
          };

          recognition.onend = () => {
            if (cancelled || !activeRef.current) return;
            window.clearTimeout(restartTimerRef.current);
            restartTimerRef.current = window.setTimeout(() => {
              launchRecognition();
            }, 260);
          };

          try {
            recognition.start();
            setStatus('armed');
          } catch {
            // Will retry cleanly via onend if transient
          }
        };

        launchRecognition();
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to access microphone for hands-free voice control.';
        setError(msg);
        setStatus('error');
        teardown();
      }
    };

    void startWakeMonitor();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [anyListeningFeatureEnabled, effectivePaused, supported, teardown]);

  return {
    supported,
    status,
    audioLevel,
    error,
    releaseMic: teardown,
  };
}
