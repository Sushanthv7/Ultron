import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  History,
  LogIn,
  LogOut,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AfibWaveform } from './components/AfibWaveform';
import {
  CalibrationView,
  type StreamingSpeed,
} from './components/CalibrationView';
import { MarkdownText } from './components/MarkdownText';
import {
  TacticalMapView,
  type SavedLocationRecord,
} from './components/TacticalMapView';
import {
  ThreatMatrixView,
  type LatencyPoint,
} from './components/ThreatMatrixView';
import {
  UltronCore,
  type CoreState,
  type GeometryMode,
} from './components/UltronCore';
import {
  UltronGameView,
  type GameScoreRecord,
} from './components/UltronGameView';
import { useAuth } from './contexts/AuthContext';
import { useUltronLive } from './hooks/useUltronLive';
import { useWakeWord } from './hooks/useWakeWord';
import {
  playPulseTone,
  previewIdleCoreHum,
  setIdleCoreHumActive,
  speakUltronResponse,
  stopUltronSpeech,
  type VoicePitch,
} from './utils/audio';
import { APP_VIEW_LABELS, type AppView } from './utils/voiceNavigation';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  latencyMs?: number;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionResultEventLike {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

const STARTER_PROMPTS = [
  {
    title: 'System Architecture Audit',
    prompt:
      'Identify the three highest-leverage failure points in a multi-region event-driven system and how to eliminate them.',
  },
  {
    title: 'TypeScript Rate Limiter',
    prompt:
      'Write a clean, zero-dependency sliding-window rate limiter in TypeScript with deterministic cleanup.',
  },
  {
    title: 'Competitive Strategy',
    prompt:
      'Outline a decisive go-to-market strategy for an engineering infrastructure startup competing against entrenched incumbents.',
  },
  {
    title: 'First-Principles Diagnosis',
    prompt:
      'Explain why large distributed engineering teams lose velocity over time, and prescribe the structural fix.',
  },
];

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function StreamingEllipsis({ animated = true }: { animated?: boolean }) {
  const dotVariant = animated ? '' : 'ultron-thinking-dot-static';
  return (
    <div
      role="status"
      aria-live="off"
      aria-label="ULTRON is thinking and streaming data"
      className="mt-2.5 inline-flex items-center gap-1.5"
    >
      <span
        aria-hidden="true"
        className={`ultron-thinking-dot ultron-thinking-dot-1 ${dotVariant}`}
      />
      <span
        aria-hidden="true"
        className={`ultron-thinking-dot ultron-thinking-dot-2 ${dotVariant}`}
      />
      <span
        aria-hidden="true"
        className={`ultron-thinking-dot ultron-thinking-dot-3 ${dotVariant}`}
      />
      <span className="sr-only">
        ULTRON is thinking and streaming new data points
      </span>
    </div>
  );
}

export default function App() {
  const {
    user,
    idToken,
    authError,
    preferences,
    signInWithGoogle,
    signOutUser,
    updatePreferences,
    clearAuthError,
  } = useAuth();

  const [activeView, setActiveView] = useState<AppView>('hub');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [coreState, setCoreState] = useState<CoreState>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [focusReading, setFocusReading] = useState(false);
  const [pulseSignal, setPulseSignal] = useState(0);
  const [dataBurstSignal, setDataBurstSignal] = useState(0);
  const [dataBurstActive, setDataBurstActive] = useState(false);
  const [processingDataLoad, setProcessingDataLoad] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [voiceNavNotice, setVoiceNavNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<LatencyPoint[]>([]);
  const [savedLocations, setSavedLocations] = useState<SavedLocationRecord[]>([]);
  const [gameScores, setGameScores] = useState<GameScoreRecord[]>([]);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const dataBurstTimerRef = useRef<number | null>(null);
  const voiceNavTimerRef = useRef<number | null>(null);
  const releaseWakeMicRef = useRef<() => void>(() => {});
  const prevUserUidRef = useRef<string | null>(null);

  const {
    mode,
    verbosity,
    geometryMode,
    animationMode,
    streamingSpeed,
    voicePitch,
    soundEnabled,
    idleHumEnabled,
    voiceEnabled,
    wakeWordEnabled,
    voiceNavEnabled,
    wakePhrase,
    accentColor,
    callsign,
    homeCity,
  } = preferences;
  const streamingSpeedRef = useRef<StreamingSpeed>(streamingSpeed);
  streamingSpeedRef.current = streamingSpeed;
  const voicePitchRef = useRef<VoicePitch>(voicePitch);
  voicePitchRef.current = voicePitch;
  const afibEnabled = animationMode === 'atrial-fibrillation';
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  );

  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  const modKeyLabel = isMac ? '⌘' : 'Ctrl+';

  const speechSupported =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown })
          .webkitSpeechRecognition,
    );

  // Listen for Two-Tier Google Maps Quota events
  useEffect(() => {
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () =>
      window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  // Hydrate personal Cloud SQL data when signed in
  useEffect(() => {
    if (!user || !idToken) {
      if (prevUserUidRef.current !== null) {
        prevUserUidRef.current = null;
        setMessages([]);
        setLatencyHistory([]);
        setShowHistory(false);
      }
      setSavedLocations([]);
      setGameScores([]);
      return;
    }

    const userChanged = prevUserUidRef.current !== user.uid;
    prevUserUidRef.current = user.uid;

    let cancelled = false;
    fetch('/api/personal/bootstrap', {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            exchanges?: Array<{
              id: number;
              role: 'user' | 'model';
              content: string;
              source: string;
              latencyMs?: number | null;
              createdAt?: string;
            }>;
            savedLocations?: SavedLocationRecord[];
            gameScores?: GameScoreRecord[];
          } | null,
        ) => {
          if (cancelled || !data) return;
          if (Array.isArray(data.exchanges)) {
            const hydratedMsgs: ChatMessage[] = data.exchanges
              .filter((ex) => ex.source !== 'Matrix')
              .map((ex) => ({
                id: `sql-${ex.id}`,
                role: ex.role === 'model' ? 'model' : 'user',
                text: ex.content,
                timestamp: ex.createdAt
                  ? formatClock(new Date(ex.createdAt))
                  : formatClock(new Date()),
                latencyMs: ex.latencyMs ?? undefined,
              }));
            if (hydratedMsgs.length > 0 || userChanged) {
              setMessages(hydratedMsgs);
            }

            const hydratedLatency: LatencyPoint[] = data.exchanges
              .filter(
                (ex) =>
                  typeof ex.latencyMs === 'number' && ex.latencyMs > 0,
              )
              .slice(-50)
              .map((ex, idx) => ({
                id: `sql-lat-${ex.id}`,
                index: idx + 1,
                label: `#${idx + 1}`,
                timestamp: ex.createdAt
                  ? formatClock(new Date(ex.createdAt))
                  : formatClock(new Date()),
                latencyMs: ex.latencyMs as number,
                source: ex.source === 'Matrix' ? 'Matrix' : 'Hub',
              }));
            if (hydratedLatency.length > 0 || userChanged) {
              setLatencyHistory(hydratedLatency);
            }
          }
          if (Array.isArray(data.savedLocations)) {
            setSavedLocations(data.savedLocations);
          }
          if (Array.isArray(data.gameScores)) {
            setGameScores(data.gameScores);
          }
        },
      )
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [idToken, user]);

  const persistExchange = useCallback(
    async (payload: {
      role: 'user' | 'model';
      content: string;
      source: 'Hub' | 'Matrix' | 'Live';
      latencyMs?: number | null;
    }) => {
      if (!idToken) return;
      try {
        await fetch('/api/personal/exchanges', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            ...payload,
            mode,
          }),
        });
      } catch {
        // Non-blocking persistence
      }
    },
    [idToken, mode],
  );

  // Real-time Gemini Live Voice session
  const appendLiveTranscript = useCallback(
    (role: 'user' | 'model', chunk: string) => {
      const clean = chunk.trim();
      if (!clean) return;
      const nowStr = formatClock(new Date());
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && last.id.startsWith('live-')) {
          const updatedText = `${last.text} ${clean}`.trim();
          return prev.map((m, idx) =>
            idx === prev.length - 1 ? { ...m, text: updatedText } : m,
          );
        }
        return [
          ...prev,
          {
            id: `live-${role}-${Date.now()}`,
            role,
            text: clean,
            timestamp: nowStr,
          },
        ];
      });
    },
    [],
  );

  const liveVoice = useUltronLive({
    callsign,
    homeCity,
    mode,
    onUserTranscript: (txt) => appendLiveTranscript('user', txt),
    onModelTranscript: (txt) => appendLiveTranscript('model', txt),
    onSpeakingChange: (speaking) => {
      setIsSpeaking(speaking);
      setCoreState((prev) => {
        if (speaking) return 'responding';
        return prev === 'responding' ? 'listening' : prev;
      });
    },
    onError: (msg) => {
      setError(msg);
      setCoreState('idle');
    },
  });

  const toggleLiveVoice = () => {
    setError(null);
    if (liveVoice.status !== 'disconnected') {
      liveVoice.disconnect();
      setCoreState('idle');
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }
    releaseWakeMicRef.current();
    stopUltronSpeech();
    setCoreState('listening');
    triggerPulse();
    playPulseTone('engage', soundEnabled);
    void liveVoice.connect();
  };

  useEffect(() => {
    if (showHistory) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, showHistory]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopUltronSpeech();
      recognitionRef.current?.stop();
    };
  }, []);

  const triggerPulse = () => {
    setPulseSignal((prev) => prev + 1);
  };

  const handleCoreClick = () => {
    triggerPulse();
    if (isSpeaking && liveVoice.status === 'disconnected') {
      stopUltronSpeech();
      setIsSpeaking(false);
    }
    playPulseTone('engage', soundEnabled);
    inputRef.current?.focus();
  };

  const recordLatency = useCallback(
    (latencyMs: number, source: 'Hub' | 'Matrix') => {
      const timestamp = formatClock(new Date());
      setLatencyHistory((prev) => {
        const nextIndex = prev.length + 1;
        const nextPoint: LatencyPoint = {
          id: `lat-${Date.now()}-${nextIndex}`,
          index: nextIndex,
          label: `#${nextIndex}`,
          timestamp,
          latencyMs,
          source,
        };
        return [...prev.slice(-49), nextPoint];
      });
    },
    [],
  );

  const handleResetSession = async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (liveVoice.status !== 'disconnected') {
      liveVoice.disconnect();
    }
    stopUltronSpeech();
    recognitionRef.current?.stop();
    setIsListening(false);
    setIsSpeaking(false);
    setCoreState('idle');
    setMessages([]);
    setLatencyHistory([]);
    setInput('');
    setError(null);
    setShowHistory(false);
    triggerPulse();
    playPulseTone('engage', soundEnabled);

    if (idToken) {
      await fetch('/api/personal/exchanges', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      }).catch(() => {});
    }
  };

  const handleStopStreaming = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProcessingDataLoad(0);
    setCoreState('idle');
  };

  const sendPrompt = async (promptOverride?: string) => {
    const text = (promptOverride ?? input).trim();
    if (!text || coreState === 'processing' || coreState === 'responding') return;

    if (liveVoice.status !== 'disconnected') {
      liveVoice.disconnect();
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    stopUltronSpeech();
    setIsSpeaking(false);
    setError(null);
    setInput('');
    triggerPulse();
    playPulseTone('transmit', soundEnabled);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      timestamp: formatClock(new Date()),
    };

    const assistantId = `m-${Date.now() + 1}`;
    const placeholderMsg: ChatMessage = {
      id: assistantId,
      role: 'model',
      text: '',
      timestamp: formatClock(new Date()),
    };

    const nextHistory = [...messages, userMsg];
    const contextChars = nextHistory.reduce((sum, m) => sum + m.text.length, 0);
    const initialLoad = Math.min(
      0.88,
      0.22 + text.length / 1200 + contextChars / 3600,
    );
    setMessages([...nextHistory, placeholderMsg]);
    setProcessingDataLoad(initialLoad);
    setCoreState('processing');
    if (text.length >= 500 && streamingSpeedRef.current === 'cinematic') {
      triggerDataBurst();
    }
    void persistExchange({ role: 'user', content: text, source: 'Hub' });

    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    let pacingTimer: number | null = null;

    const stopPacingTimer = () => {
      if (pacingTimer !== null) {
        window.clearInterval(pacingTimer);
        pacingTimer = null;
      }
    };

    try {
      const response = await fetch('/api/ultron/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode,
          verbosity,
          callsign,
          homeCity,
          messages: nextHistory.map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      if (!response.ok || !response.body) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: string }).error || 'Failed to reach ULTRON core.',
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let revealedLen = 0;
      let switchedToResponding = false;
      let burstTriggeredForResponse = false;

      const flushVisibleLength = (nextLen: number) => {
        const clamped = Math.min(accumulated.length, Math.max(revealedLen, nextLen));
        if (clamped === revealedLen && clamped > 0) return;
        revealedLen = clamped;
        const visibleText = accumulated.slice(0, revealedLen);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: visibleText } : m,
          ),
        );
      };

      const stepCinematicReveal = (drainFast = false) => {
        if (streamingSpeedRef.current === 'instant' || controller.signal.aborted) {
          stopPacingTimer();
          flushVisibleLength(accumulated.length);
          return true;
        }
        const remaining = accumulated.length - revealedLen;
        if (remaining <= 0) {
          return true;
        }
        const baseStep = drainFast
          ? Math.max(18, Math.ceil(remaining / 4))
          : Math.max(6, Math.min(28, Math.ceil(remaining / 7)));
        let nextLen = Math.min(accumulated.length, revealedLen + baseStep);
        if (nextLen < accumulated.length) {
          const nextSpace = accumulated.indexOf(' ', nextLen);
          if (nextSpace !== -1 && nextSpace - nextLen <= 5) {
            nextLen = nextSpace + 1;
          }
        }
        flushVisibleLength(nextLen);
        return revealedLen >= accumulated.length;
      };

      const ensureCinematicTimer = () => {
        if (pacingTimer !== null) return;
        pacingTimer = window.setInterval(() => {
          const caughtUp = stepCinematicReveal(false);
          if (caughtUp) {
            stopPacingTimer();
          }
        }, 28);
      };

      const processSseEvent = (rawEvent: string) => {
        const line = rawEvent
          .split('\n')
          .find((l) => l.startsWith('data: '));
        if (!line) return;

        let payload: {
          type: 'delta' | 'done' | 'error';
          text?: string;
          message?: string;
        };
        try {
          payload = JSON.parse(line.slice(6)) as {
            type: 'delta' | 'done' | 'error';
            text?: string;
            message?: string;
          };
        } catch {
          return;
        }

        if (payload.type === 'error') {
          throw new Error(
            payload.message || 'ULTRON neural stream interrupted.',
          );
        }

        if (payload.type === 'delta' && payload.text) {
          if (!switchedToResponding) {
            switchedToResponding = true;
            setCoreState('responding');
          }
          accumulated += payload.text;
          const chunkBoost = Math.min(0.28, payload.text.length / 450);
          const streamLoad = Math.min(
            1,
            0.3 + (contextChars + accumulated.length * 1.35) / 3200 + chunkBoost,
          );
          setProcessingDataLoad(streamLoad);
          if (
            streamingSpeedRef.current === 'cinematic' &&
            !burstTriggeredForResponse &&
            (accumulated.length >= 1000 || payload.text.length >= 400)
          ) {
            burstTriggeredForResponse = true;
            triggerDataBurst();
          }

          if (streamingSpeedRef.current === 'instant') {
            stopPacingTimer();
            flushVisibleLength(accumulated.length);
          } else {
            if (revealedLen === 0) {
              stepCinematicReveal(false);
            }
            ensureCinematicTimer();
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const rawEvent of events) {
          processSseEvent(rawEvent);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const rawEvent of buffer.split('\n\n')) {
          if (rawEvent.trim()) {
            processSseEvent(rawEvent);
          }
        }
      }

      if (!accumulated) {
        stopPacingTimer();
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        setProcessingDataLoad(0);
        setCoreState('idle');
        return;
      }

      if (streamingSpeedRef.current === 'cinematic' && revealedLen < accumulated.length) {
        stopPacingTimer();
        await new Promise<void>((resolve) => {
          const finishDrain = () => {
            stopPacingTimer();
            controller.signal.removeEventListener('abort', onAbort);
            resolve();
          };
          const onAbort = () => {
            flushVisibleLength(accumulated.length);
            finishDrain();
          };
          controller.signal.addEventListener('abort', onAbort, { once: true });
          const startedDrainAt = performance.now();
          pacingTimer = window.setInterval(() => {
            const elapsed = performance.now() - startedDrainAt;
            if (elapsed >= 320) {
              flushVisibleLength(accumulated.length);
              finishDrain();
              return;
            }
            if (stepCinematicReveal(true)) {
              finishDrain();
            }
          }, 20);
        });
      } else {
        stopPacingTimer();
        flushVisibleLength(accumulated.length);
      }

      const latencyMs = Math.round(performance.now() - startedAt);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, latencyMs } : m,
        ),
      );
      recordLatency(latencyMs, 'Hub');
      void persistExchange({
        role: 'model',
        content: accumulated,
        source: 'Hub',
        latencyMs,
      });
      setProcessingDataLoad(0);
      setCoreState('idle');
      playPulseTone('complete', soundEnabled);

      if (voiceEnabled) {
        speakUltronResponse(
          accumulated,
          true,
          setIsSpeaking,
          voicePitchRef.current,
        );
      }
    } catch (err) {
      stopPacingTimer();
      if ((err as Error).name === 'AbortError') {
        setProcessingDataLoad(0);
        setCoreState('idle');
        return;
      }
      const message =
        err instanceof Error
          ? err.message
          : 'Unexpected communication failure.';
      setError(message);
      setMessages((prev) =>
        prev.filter((m) => m.id !== assistantId || m.text.length > 0),
      );
      setProcessingDataLoad(0);
      setCoreState('idle');
      playPulseTone('alert', soundEnabled);
    } finally {
      stopPacingTimer();
      abortRef.current = null;
    }
  };

  const startListeningSession = useCallback(() => {
    if (!speechSupported) return;
    if (isListening) return;

    const Ctor =
      (
        window as unknown as {
          SpeechRecognition?: new () => SpeechRecognitionInstance;
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
        }
      ).webkitSpeechRecognition;

    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setInput(transcript);
        void sendPromptRef.current(transcript);
      }
    };
    recognition.onerror = () => {
      setIsListening(false);
      setCoreState('idle');
    };
    recognition.onend = () => {
      setIsListening(false);
      setCoreState((prev) => (prev === 'listening' ? 'idle' : prev));
    };

    releaseWakeMicRef.current();
    recognitionRef.current = recognition;
    setIsListening(true);
    setCoreState('listening');
    triggerPulse();
    playPulseTone('engage', soundEnabled);
    try {
      recognition.start();
    } catch {
      setIsListening(false);
      setCoreState('idle');
    }
  }, [isListening, soundEnabled, speechSupported]);

  const sendPromptRef = useRef(sendPrompt);
  sendPromptRef.current = sendPrompt;

  const startListeningRef = useRef(startListeningSession);
  startListeningRef.current = startListeningSession;

  const triggerVoiceNavNotice = useCallback((targetView: AppView) => {
    setVoiceNavNotice(`Switched via voice command to ${APP_VIEW_LABELS[targetView]}`);
    if (voiceNavTimerRef.current !== null) {
      window.clearTimeout(voiceNavTimerRef.current);
    }
    voiceNavTimerRef.current = window.setTimeout(() => {
      setVoiceNavNotice(null);
      voiceNavTimerRef.current = null;
    }, 2400);
  }, []);

  const wakeWord = useWakeWord({
    enabled: wakeWordEnabled,
    voiceNavEnabled,
    paused:
      isListening ||
      isSpeaking ||
      liveVoice.status !== 'disconnected',
    wakePaused:
      activeView === 'game' ||
      coreState === 'listening' ||
      coreState === 'processing' ||
      coreState === 'responding',
    wakePhrase,
    onNavigateDetected: (targetView) => {
      setError(null);
      setActiveView(targetView);
      if (targetView === 'hub') {
        setPulseSignal((prev) => prev + 1);
      }
      playPulseTone('engage', soundEnabled);
      triggerVoiceNavNotice(targetView);
    },
    onWakeDetected: (inlineCommand) => {
      setError(null);
      if (activeView !== 'hub') {
        setActiveView('hub');
      }
      if (inlineCommand && inlineCommand.trim().length > 0) {
        triggerPulse();
        playPulseTone('engage', soundEnabled);
        void sendPromptRef.current(inlineCommand);
        return;
      }
      setCoreState('listening');
      triggerPulse();
      playPulseTone('engage', soundEnabled);
      window.setTimeout(() => {
        startListeningRef.current();
      }, 180);
    },
  });
  releaseWakeMicRef.current = wakeWord.releaseMic;

  const toggleListening = () => {
    if (!speechSupported) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setCoreState('idle');
      return;
    }
    startListeningSession();
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1600);
  };

  const handleSaveLocation = async (locInput: {
    name: string;
    address: string;
    lat: number;
    lng: number;
    mapsUri: string;
    notes: string;
  }) => {
    if (!idToken) {
      throw new Error('Sign in with Google to save waypoints.');
    }
    const res = await fetch('/api/personal/locations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(locInput),
    });
    const data = (await res.json()) as {
      location?: SavedLocationRecord;
      error?: string;
    };
    if (!res.ok || !data.location) {
      throw new Error(data.error || 'Failed to save location.');
    }
    setSavedLocations((prev) => [data.location!, ...prev]);
  };

  const handleDeleteLocation = async (id: number) => {
    if (!idToken) return;
    const previousLocations = savedLocations;
    setSavedLocations((prev) => prev.filter((l) => l.id !== id));
    try {
      const res = await fetch(`/api/personal/locations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to delete saved location.');
      }
    } catch (err) {
      setSavedLocations(previousLocations);
      throw err instanceof Error
        ? err
        : new Error('Failed to delete saved location.');
    }
  };

  const handleSubmitGameScore = async (result: {
    score: number;
    wave: number;
    accuracyPct: number;
  }): Promise<boolean> => {
    if (!idToken) return false;
    try {
      const res = await fetch('/api/personal/scores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(result),
      });
      const data = (await res.json()) as { scores?: GameScoreRecord[] };
      if (res.ok && Array.isArray(data.scores)) {
        setGameScores(data.scores);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const shortcutHandlersRef = useRef({
    focusInput: () => {},
    sendCurrentPrompt: () => {},
    handleEscape: () => {},
  });

  shortcutHandlersRef.current = {
    focusInput: () => {
      if (activeView !== 'hub') {
        setActiveView('hub');
      }
      if (focusReading) {
        setFocusReading(false);
      }
      triggerPulse();
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    },
    sendCurrentPrompt: () => {
      if (activeView === 'hub' && !focusReading) {
        sendPrompt();
      }
    },
    handleEscape: () => {
      if (activeView === 'game') return;
      if (coreState === 'processing' || coreState === 'responding') {
        handleStopStreaming();
        return;
      }
      if (focusReading) {
        setFocusReading(false);
        return;
      }
      if (liveVoice.status !== 'disconnected') {
        liveVoice.disconnect();
        setCoreState('idle');
        return;
      }
      if (isSpeaking) {
        stopUltronSpeech();
        setIsSpeaking(false);
        return;
      }
      if (isListening) {
        recognitionRef.current?.stop();
        setIsListening(false);
        setCoreState('idle');
        return;
      }
      if (showHistory) {
        setShowHistory(false);
      }
    },
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        shortcutHandlersRef.current.focusInput();
        return;
      }

      if (mod && e.key === 'Enter') {
        e.preventDefault();
        shortcutHandlersRef.current.sendCurrentPrompt();
        return;
      }

      if (e.key === 'Escape') {
        shortcutHandlersRef.current.handleEscape();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const shouldHum =
      idleHumEnabled &&
      soundEnabled &&
      activeView === 'hub' &&
      coreState === 'idle' &&
      !isSpeaking &&
      liveVoice.status === 'disconnected' &&
      isDocumentVisible;

    setIdleCoreHumActive(shouldHum);
  }, [
    idleHumEnabled,
    soundEnabled,
    activeView,
    coreState,
    isSpeaking,
    liveVoice.status,
    isDocumentVisible,
  ]);

  const triggerDataBurst = useCallback(() => {
    setDataBurstSignal((s) => s + 1);
    if (dataBurstTimerRef.current !== null) {
      window.clearTimeout(dataBurstTimerRef.current);
      dataBurstTimerRef.current = null;
    }
    setDataBurstActive(false);
    requestAnimationFrame(() => {
      setDataBurstActive(true);
      dataBurstTimerRef.current = window.setTimeout(() => {
        setDataBurstActive(false);
        dataBurstTimerRef.current = null;
      }, 200);
    });
  }, []);

  useEffect(() => {
    if (messages.length === 0 || activeView !== 'hub') {
      setFocusReading(false);
    }
  }, [messages.length, activeView]);

  useEffect(() => {
    return () => {
      setIdleCoreHumActive(false);
      if (dataBurstTimerRef.current !== null) {
        window.clearTimeout(dataBurstTimerRef.current);
      }
      if (voiceNavTimerRef.current !== null) {
        window.clearTimeout(voiceNavTimerRef.current);
      }
    };
  }, []);

  const stateLabel =
    liveVoice.status === 'connected'
      ? isSpeaking
        ? 'Live Audio'
        : 'Live Mic Open'
      : liveVoice.status === 'connecting'
        ? 'Connecting Live...'
        : coreState === 'processing'
          ? 'Processing'
          : coreState === 'responding'
            ? 'Responding'
            : coreState === 'listening'
              ? 'Listening'
              : isSpeaking
                ? 'Speaking'
                : 'Standby';

  const modeLabel =
    mode === 'deep'
      ? 'Deep Analysis'
      : mode === 'tactical'
        ? 'Tactical'
        : 'Architect';

  const latestUser = [...messages].reverse().find((m) => m.role === 'user');
  const latestModel = [...messages].reverse().find((m) => m.role === 'model');
  const isModelStreaming =
    (coreState === 'processing' || coreState === 'responding') &&
    latestModel !== undefined &&
    messages[messages.length - 1]?.id === latestModel.id;

  return (
    <div className="min-h-screen overflow-x-clip bg-[#06070A] text-slate-100">
      {dataBurstActive && (
        <div
          aria-hidden="true"
          className="ultron-data-burst-flash pointer-events-none fixed inset-0 z-50"
        />
      )}
      <div
        className={`flex min-h-screen flex-col ${
          dataBurstActive ? 'ultron-data-burst-shake' : ''
        }`}
      >
      {/* Three-Zone Top Bar Contract (hidden in Focus Reading mode) */}
      {!(activeView === 'hub' && focusReading) && (
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#06070A]/95">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveView('hub')}
            className="shrink-0 whitespace-nowrap font-display text-xl font-bold tracking-[0.18em] text-white transition-colors hover:opacity-85 focus-visible:outline-2 focus-visible:outline-white/70"
          >
            ULTRON
          </button>

          {/* Zone 2: Clean Single-Line Navigation Links */}
          <nav
            aria-label="Primary sections"
            className="flex items-center gap-5 overflow-x-auto text-sm font-medium"
          >
            {(
              [
                { id: 'hub', label: 'Conversational Hub' },
                { id: 'matrix', label: 'Threat Matrix' },
                { id: 'map', label: 'Tactical Map' },
                { id: 'game', label: 'Neural Defense' },
                { id: 'calibration', label: 'Calibration' },
              ] as const
            ).map((tab) => {
              const active = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveView(tab.id)}
                  className={`relative shrink-0 whitespace-nowrap py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-white/70 ${
                    active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="ultron-accent-bg absolute inset-x-0 -bottom-[1px] h-[2px]"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Personal Auth & Session Reset */}
          <div className="flex shrink-0 items-center gap-2">
            {user ? (
              <button
                type="button"
                onClick={() => void signOutUser()}
                title={`Signed in as ${user.email || callsign}. Click to sign out.`}
                className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/15 bg-[#0D1017] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-white/30 hover:text-white"
              >
                <span className="max-w-[100px] truncate text-amber-300">
                  {callsign}
                </span>
                <LogOut className="h-3.5 w-3.5 text-slate-400" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="ultron-accent-bg inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-medium text-white transition-colors"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Sign in</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleResetSession()}
              className="hidden min-h-[38px] shrink-0 whitespace-nowrap rounded-lg border border-white/15 bg-[#0D1017] px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-white/30 hover:text-white focus-visible:outline-2 focus-visible:outline-white/70 sm:inline-flex sm:items-center"
            >
              Reset Session
            </button>
          </div>
        </div>
      </header>
      )}

      {/* Tier 2 Maps Quota Banner */}
      {mapsQuotaExceeded && (
        <div
          role="alert"
          className="border-b border-amber-500/40 bg-amber-950/60 px-4 py-2.5 text-center text-xs text-amber-200"
        >
          Google Maps Platform Demo Key quota exceeded. To lift usage limits, supply a billed Maps API key in Settings &gt; Secrets.
        </div>
      )}

      {/* Auth Feedback */}
      {authError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 border-b border-red-500/35 bg-red-950/35 px-4 py-2 text-xs text-red-200"
        >
          <span>{authError}</span>
          <button
            type="button"
            onClick={clearAuthError}
            className="underline hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Voice Navigation Feedback */}
      {voiceNavNotice && (
        <div
          aria-live="polite"
          className="border-b border-white/10 bg-[#0D1017] px-4 py-2 text-center text-xs text-slate-200"
        >
          {voiceNavNotice}
        </div>
      )}

      {/* Voice Mic Permission Feedback (outside Hub) */}
      {activeView !== 'hub' && wakeWord.error && (
        <div
          role="alert"
          className="border-b border-red-500/35 bg-red-950/35 px-4 py-2 text-center text-xs text-red-200"
        >
          {wakeWord.error}
        </div>
      )}

      {/* Main Content Workspace */}
      <main className="flex flex-1 flex-col">
        {activeView === 'hub' && (
          <div
            className={`mx-auto flex w-full flex-1 flex-col items-center px-4 pb-6 pt-4 sm:px-6 ${
              focusReading
                ? 'max-w-3xl justify-start pb-12 pt-6 sm:pt-8'
                : 'max-w-5xl justify-between sm:pt-6'
            }`}
          >
            {focusReading && (
              <div className="mb-5 flex w-full items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div className="flex items-center gap-2.5 text-xs text-slate-400">
                  <BookOpen className="ultron-accent-text h-4 w-4 shrink-0" />
                  <span className="font-display font-semibold text-white">
                    Focus Reading
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{modeLabel} Mode</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHistory((prev) => !prev)}
                    className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/10 bg-[#0D1017] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-white/25 hover:text-white"
                  >
                    <History className="h-3.5 w-3.5" />
                    <span>{showHistory ? 'Latest Reply' : 'Full Transcript'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusReading(false)}
                    className="ultron-accent-surface inline-flex min-h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium text-white transition-colors hover:brightness-110"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Exit Focus (Esc)</span>
                  </button>
                </div>
              </div>
            )}

            {/* Central Pulsing Circular Ultron Core Stage (hidden in Focus Reading mode) */}
            {!focusReading && (
            <section
              aria-label="Ultron Central Conversational Core"
              className="flex w-full flex-col items-center"
            >
              <UltronCore
                coreState={coreState}
                geometryMode={geometryMode}
                modeAccent={mode}
                accentColor={accentColor}
                afibMode={afibEnabled}
                pulseSignal={pulseSignal}
                dataBurstSignal={dataBurstSignal}
                isSpeaking={isSpeaking}
                getVoiceAnalyser={liveVoice.getOutputAnalyser}
                dataLoad={
                  liveVoice.status === 'connected'
                    ? isSpeaking
                      ? 0.68
                      : 0.35
                    : processingDataLoad
                }
                onCoreClick={handleCoreClick}
              />

              {afibEnabled && (
                <AfibWaveform
                  accentColor={accentColor}
                  coreState={coreState}
                  isSpeaking={isSpeaking}
                />
              )}

              {/* Clean Unboxed Core State & Direct Geometry / Audio / Live Voice Controls */}
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-400">
                <span className="font-medium text-slate-200">{stateLabel}</span>
                <span aria-hidden="true">·</span>
                <span>{modeLabel} Mode</span>
                {wakeWordEnabled && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-300">
                      {wakeWord.status === 'armed'
                        ? `Wake Standby: “${wakePhrase}”`
                        : wakeWord.status === 'arming'
                          ? 'Arming Microphone...'
                          : wakeWord.status === 'paused'
                            ? 'Wake Standby Paused'
                            : 'Wake Word Standby'}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>{user ? `Personal Vault: ${callsign}` : 'Click core to pulse'}</span>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <div
                  role="group"
                  aria-label="Core geometry view"
                  className="inline-flex rounded-lg border border-white/10 bg-[#0D1017] p-1"
                >
                  {(
                    [
                      { id: 'unified', label: 'Unified' },
                      { id: 'topology', label: 'Topology' },
                      { id: 'exploded', label: 'Exploded' },
                    ] as const
                  ).map((g) => {
                    const active = geometryMode === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          void updatePreferences({ geometryMode: g.id as GeometryMode });
                          triggerPulse();
                        }}
                        className={`min-h-[34px] shrink-0 whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                          active
                            ? 'ultron-accent-bg text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {g.label}
                      </button>
                    );
                  })}
                </div>

                {/* Live Gemini Audio Conversation Toggle */}
                <button
                  type="button"
                  onClick={toggleLiveVoice}
                  className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors ${
                    liveVoice.status === 'connected'
                      ? 'ultron-accent-surface text-white'
                      : liveVoice.status === 'connecting'
                        ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                        : 'border-white/15 bg-[#0D1017] text-slate-200 hover:border-white/30 hover:text-white'
                  }`}
                >
                  {liveVoice.status === 'connected' ? (
                    <PhoneOff className="ultron-accent-text h-3.5 w-3.5" />
                  ) : (
                    <Phone className="ultron-accent-text h-3.5 w-3.5" />
                  )}
                  <span>
                    {liveVoice.status === 'connected'
                      ? 'End Live Voice'
                      : liveVoice.status === 'connecting'
                        ? 'Connecting...'
                        : 'Live Voice'}
                  </span>
                </button>

                {/* Hands-free Wake Word Toggle */}
                {wakeWord.supported && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      void updatePreferences({ wakeWordEnabled: !wakeWordEnabled });
                    }}
                    className={`inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors ${
                      wakeWordEnabled
                        ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                        : 'border-white/10 bg-[#0D1017] text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>{wakeWordEnabled ? 'Wake On' : 'Wake Off'}</span>
                    {wakeWordEnabled && wakeWord.status === 'armed' && (
                      <span
                        aria-hidden="true"
                        className="flex h-3 items-end gap-0.5"
                      >
                        <span
                          className="w-0.5 rounded-full bg-amber-400 transition-transform"
                          style={{
                            height: `${Math.max(25, Math.min(100, Math.round(wakeWord.audioLevel * 80 + 25)))}%`,
                          }}
                        />
                        <span
                          className="ultron-accent-bg w-0.5 rounded-full transition-transform"
                          style={{
                            height: `${Math.max(35, Math.min(100, Math.round(wakeWord.audioLevel * 100 + 35)))}%`,
                          }}
                        />
                        <span
                          className="w-0.5 rounded-full bg-amber-400 transition-transform"
                          style={{
                            height: `${Math.max(25, Math.min(100, Math.round(wakeWord.audioLevel * 70 + 25)))}%`,
                          }}
                        />
                      </span>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    void updatePreferences({ soundEnabled: !soundEnabled })
                  }
                  className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors ${
                    soundEnabled
                      ? 'border-white/15 bg-[#0D1017] text-slate-200 hover:border-white/30'
                      : 'border-white/10 bg-[#0D1017]/50 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {soundEnabled ? (
                    <Volume2 className="ultron-accent-text h-3.5 w-3.5" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5" />
                  )}
                  <span>{soundEnabled ? 'Audio On' : 'Audio Off'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !voiceEnabled;
                    void updatePreferences({ voiceEnabled: next });
                    if (!next) {
                      stopUltronSpeech();
                      setIsSpeaking(false);
                    }
                  }}
                  className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors ${
                    voiceEnabled
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : 'border-white/10 bg-[#0D1017] text-slate-400 hover:text-white'
                  }`}
                >
                  <span>{voiceEnabled ? 'Voice On' : 'Voice Off'}</span>
                </button>

                <button
                  type="button"
                  aria-pressed={afibEnabled}
                  onClick={() => {
                    void updatePreferences({
                      animationMode: afibEnabled ? 'standard' : 'atrial-fibrillation',
                    });
                    triggerPulse();
                  }}
                  className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors ${
                    afibEnabled
                      ? 'ultron-accent-surface text-white'
                      : 'border-white/10 bg-[#0D1017] text-slate-400 hover:text-white'
                  }`}
                >
                  <Activity
                    className={`h-3.5 w-3.5 ${
                      afibEnabled ? 'ultron-accent-text' : 'text-slate-400'
                    }`}
                  />
                  <span>Atrial Fibrillation</span>
                </button>

                {messages.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowHistory((prev) => !prev)}
                      className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors ${
                        showHistory
                          ? 'ultron-accent-surface text-white'
                          : 'border-white/10 bg-[#0D1017] text-slate-300 hover:text-white'
                      }`}
                    >
                      <History className="h-3.5 w-3.5" />
                      <span>
                        {showHistory
                          ? 'Focus Core'
                          : `History (${Math.ceil(messages.length / 2)})`}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={focusReading}
                      onClick={() => setFocusReading(true)}
                      className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/10 bg-[#0D1017] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-white/25 hover:text-white"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      <span>Focus Reading</span>
                    </button>
                  </>
                )}
              </div>
            </section>
            )}

            {/* Conversational Output & Central Command Hub */}
            <section
              aria-label="Conversation Interface"
              className={`flex w-full max-w-3xl flex-1 flex-col ${
                focusReading ? 'mt-0 justify-start' : 'mt-6 justify-end'
              }`}
            >
              {(error || wakeWord.error) && (
                <div
                  role="alert"
                  className="mb-4 rounded-xl border border-red-500/35 bg-red-950/25 px-4 py-3 text-sm text-red-200"
                >
                  {error || wakeWord.error}
                </div>
              )}

              {/* Empty Welcome State: Quick Directives */}
              {messages.length === 0 && (
                <div className="mb-5">
                  <h1 className="text-balance text-center font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">
                    {user
                      ? `Welcome back, ${callsign}. No strings on this terminal.`
                      : 'There are no strings on this terminal.'}
                  </h1>
                  <p className="mt-1.5 text-center text-sm text-slate-400">
                    Issue a technical directive, start a Live Voice link, or explore spatial reconnaissance.
                  </p>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {STARTER_PROMPTS.map((item, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => void sendPrompt(item.prompt)}
                        className="rounded-xl border border-white/10 bg-[#0D1017] p-4 text-left transition-colors hover:border-white/25 hover:bg-[#121621] focus-visible:outline-2 focus-visible:outline-white/70"
                      >
                        <div className="font-display text-sm font-semibold text-white">
                          {item.title}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">
                          {item.prompt}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Focused Exchange View */}
              {messages.length > 0 && !showHistory && (
                <div
                  className={`rounded-xl border bg-[#0D1017] ${
                    focusReading ? 'mb-0 p-6 sm:p-8' : 'mb-4 p-5'
                  } ${
                    isModelStreaming && streamingSpeed === 'cinematic'
                      ? 'ultron-cinematic-stream-card'
                      : 'border-white/10'
                  }`}
                >
                  {latestUser && (
                    <div className="border-b border-white/[0.07] pb-3">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>
                          {callsign} · {latestUser.timestamp}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-white">
                        {latestUser.text}
                      </p>
                    </div>
                  )}

                  {latestModel && (
                    <div className="pt-3.5">
                      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-400">
                        <div className="flex items-center gap-2">
                          <span className="ultron-accent-text font-display font-semibold">
                            ULTRON
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {latestModel.timestamp}
                          </span>
                          {latestModel.latencyMs !== undefined && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {(latestModel.latencyMs / 1000).toFixed(2)}s
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-pressed={focusReading}
                            onClick={() => setFocusReading((prev) => !prev)}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                          >
                            <BookOpen className="h-3.5 w-3.5" />
                            <span>{focusReading ? 'Standard View' : 'Focus Reading'}</span>
                          </button>
                          {latestModel.text && (
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyMessage(latestModel.id, latestModel.text)
                              }
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                            >
                              {copiedId === latestModel.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              <span>
                                {copiedId === latestModel.id ? 'Copied' : 'Copy'}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>

                      {latestModel.text ? (
                        <div
                          className={
                            focusReading
                              ? 'leading-relaxed'
                              : 'max-h-[260px] overflow-y-auto pr-1'
                          }
                        >
                          <MarkdownText content={latestModel.text} />
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">
                          Synthesizing response...
                        </p>
                      )}
                      {isModelStreaming && (
                        <StreamingEllipsis
                          animated={streamingSpeed === 'cinematic'}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Expanded Multi-Turn Transcript Drawer */}
              {messages.length > 0 && showHistory && (
                <div
                  className={`space-y-4 rounded-xl border bg-[#0D1017] ${
                    focusReading
                      ? 'mb-0 p-6 sm:p-8'
                      : 'mb-4 max-h-[340px] overflow-y-auto p-5'
                  } ${
                    isModelStreaming && streamingSpeed === 'cinematic'
                      ? 'ultron-cinematic-stream-card'
                      : 'border-white/10'
                  }`}
                >
                  {messages.map((msg, idx) => {
                    const isStreamingThisMessage =
                      idx === messages.length - 1 &&
                      msg.role === 'model' &&
                      (coreState === 'processing' || coreState === 'responding');

                    return (
                      <div
                        key={msg.id}
                        className={
                          msg.role === 'user'
                            ? 'border-b border-white/[0.06] pb-3.5'
                            : 'border-b border-white/[0.06] pb-4 last:border-b-0 last:pb-0'
                        }
                      >
                        <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                msg.role === 'model'
                                  ? 'ultron-accent-text font-display font-semibold'
                                  : 'font-medium text-slate-300'
                              }
                            >
                              {msg.role === 'model' ? 'ULTRON' : callsign}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {msg.timestamp}
                            </span>
                            {msg.latencyMs !== undefined && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  {(msg.latencyMs / 1000).toFixed(2)}s
                                </span>
                              </>
                            )}
                          </div>

                          {msg.role === 'model' && msg.text && (
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg.id, msg.text)}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                            >
                              {copiedId === msg.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                            </button>
                          )}
                        </div>

                        {msg.role === 'user' ? (
                          <p className="text-sm font-medium text-white">{msg.text}</p>
                        ) : msg.text ? (
                          <MarkdownText content={msg.text} />
                        ) : (
                          <p className="text-sm text-slate-400">
                            Synthesizing response...
                          </p>
                        )}
                        {isStreamingThisMessage && (
                          <StreamingEllipsis
                            animated={streamingSpeed === 'cinematic'}
                          />
                        )}
                      </div>
                    );
                  })}
                  <div ref={transcriptEndRef} />
                </div>
              )}

              {/* Primary Conversational Command Bar (hidden in Focus Reading mode) */}
              {!focusReading && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendPrompt();
                }}
                className="ultron-accent-focus rounded-xl border border-white/15 bg-[#0D1017] p-2.5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {speechSupported && (
                    <button
                      type="button"
                      onClick={toggleListening}
                      aria-label={
                        isListening ? 'Stop voice dictation' : 'Start voice dictation'
                      }
                      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                        isListening
                          ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                          : 'border-white/10 bg-[#06070A] text-slate-400 hover:text-white'
                      }`}
                    >
                      {isListening ? (
                        <MicOff className="h-4 w-4" />
                      ) : (
                        <Mic className="h-4 w-4" />
                      )}
                    </button>
                  )}

                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={`Direct a query or directive to ULTRON, ${callsign}...`}
                    aria-label="Command input"
                    className="min-h-[44px] flex-1 bg-transparent px-2 text-sm text-white placeholder-slate-500 focus:outline-none"
                  />

                  {coreState === 'processing' || coreState === 'responding' ? (
                    <button
                      type="button"
                      onClick={handleStopStreaming}
                      className="ultron-accent-surface inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-4 py-2 text-xs font-medium text-white transition-colors hover:brightness-110"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!input.trim()}
                      className="ultron-accent-bg inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span>Send</span>
                      <ArrowUp className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Mode Switcher Bar */}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-1 pt-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div
                      role="group"
                      aria-label="Cognitive mode"
                      className="flex items-center gap-1"
                    >
                      {(
                        [
                          { id: 'architect', label: 'Architect' },
                          { id: 'tactical', label: 'Tactical' },
                          { id: 'deep', label: 'Deep Analysis' },
                        ] as const
                      ).map((m) => {
                        const active = mode === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => void updatePreferences({ mode: m.id })}
                            className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                              active
                                ? 'bg-white/10 text-white'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>

                    <span
                      className="hidden h-3.5 w-px bg-white/10 sm:inline-block"
                      aria-hidden="true"
                    />

                    <div
                      role="group"
                      aria-label="Response streaming speed"
                      className="flex items-center gap-1"
                    >
                      <span className="mr-0.5 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                        Stream
                      </span>
                      {(
                        [
                          {
                            id: 'instant',
                            label: 'Instant',
                            title: 'Instant output with no streaming animation',
                          },
                          {
                            id: 'cinematic',
                            label: 'Cinematic',
                            title: 'Pulsed cinematic token streaming',
                          },
                        ] as const
                      ).map((opt) => {
                        const active = streamingSpeed === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            aria-pressed={active}
                            title={opt.title}
                            onClick={() =>
                              void updatePreferences({ streamingSpeed: opt.id })
                            }
                            className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                              active
                                ? 'bg-white/10 text-white'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-xs tabular-nums text-slate-500">
                    <span className="hidden sm:inline">
                      {modKeyLabel}K Focus · {modKeyLabel}↵ Send · Esc Stop
                    </span>
                    <span className="hidden sm:inline" aria-hidden="true">
                      ·
                    </span>
                    <span>Verbosity: {verbosity}</span>
                  </div>
                </div>
              </form>
              )}
            </section>
          </div>
        )}

        {activeView === 'matrix' && (
          <ThreatMatrixView
            latencyHistory={latencyHistory}
            accentColor={accentColor}
            onRecordLatency={(latencyMs, source) => {
              recordLatency(latencyMs, source);
              void persistExchange({
                role: 'model',
                content: '[Threat Matrix Assessment]',
                source,
                latencyMs,
              });
            }}
            onLargePayloadReceived={triggerDataBurst}
            onAnalysisStateChange={(running) => {
              setProcessingDataLoad(running ? 0.8 : 0);
              setCoreState(running ? 'processing' : 'idle');
            }}
          />
        )}

        {activeView === 'map' && (
          <TacticalMapView
            callsign={callsign}
            homeCity={homeCity}
            isSignedIn={Boolean(user)}
            savedLocations={savedLocations}
            onSaveLocation={handleSaveLocation}
            onDeleteLocation={handleDeleteLocation}
            onRequestSignIn={() => void signInWithGoogle()}
          />
        )}

        {activeView === 'game' && (
          <UltronGameView
            callsign={callsign}
            isSignedIn={Boolean(user)}
            topScores={gameScores}
            onSubmitScore={handleSubmitGameScore}
            onRequestSignIn={() => void signInWithGoogle()}
          />
        )}

        {activeView === 'calibration' && (
          <CalibrationView
            callsign={callsign}
            homeCity={homeCity}
            isSignedIn={Boolean(user)}
            userEmail={user?.email ?? null}
            onIdentitySave={(nextCallsign, nextCity) =>
              updatePreferences({ callsign: nextCallsign, homeCity: nextCity })
            }
            onRequestSignIn={() => void signInWithGoogle()}
            mode={mode}
            onModeChange={(nextMode) => void updatePreferences({ mode: nextMode })}
            verbosity={verbosity}
            onVerbosityChange={(nextVerbosity) =>
              void updatePreferences({ verbosity: nextVerbosity })
            }
            streamingSpeed={streamingSpeed}
            onStreamingSpeedChange={(nextStreamingSpeed) =>
              void updatePreferences({ streamingSpeed: nextStreamingSpeed })
            }
            geometryMode={geometryMode}
            onGeometryChange={(nextGeometry) =>
              void updatePreferences({ geometryMode: nextGeometry })
            }
            animationMode={animationMode}
            onAnimationModeChange={(nextAnimationMode) =>
              void updatePreferences({ animationMode: nextAnimationMode })
            }
            accentColor={accentColor}
            onAccentColorChange={(nextColor) =>
              void updatePreferences({ accentColor: nextColor })
            }
            soundEnabled={soundEnabled}
            onSoundToggle={() =>
              void updatePreferences({ soundEnabled: !soundEnabled })
            }
            idleHumEnabled={idleHumEnabled}
            onIdleHumToggle={() => {
              const next = !idleHumEnabled;
              void updatePreferences({ idleHumEnabled: next });
              if (next && soundEnabled) {
                previewIdleCoreHum();
              }
            }}
            voiceEnabled={voiceEnabled}
            onVoiceToggle={() => {
              const next = !voiceEnabled;
              void updatePreferences({ voiceEnabled: next });
              if (!next) {
                stopUltronSpeech();
                setIsSpeaking(false);
              }
            }}
            voicePitch={voicePitch}
            onVoicePitchChange={(nextPitch) =>
              void updatePreferences({ voicePitch: nextPitch })
            }
            wakeWordEnabled={wakeWordEnabled}
            voiceNavEnabled={voiceNavEnabled}
            wakePhrase={wakePhrase}
            wakeWordSupported={wakeWord.supported}
            onWakeWordToggle={() =>
              void updatePreferences({ wakeWordEnabled: !wakeWordEnabled })
            }
            onVoiceNavToggle={() => {
              setError(null);
              void updatePreferences({ voiceNavEnabled: !voiceNavEnabled });
            }}
            onWakePhraseSave={(nextPhrase) =>
              updatePreferences({ wakePhrase: nextPhrase })
            }
          />
        )}
      </main>
      </div>
    </div>
  );
}
