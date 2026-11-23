import { useCallback, useEffect, useRef, useState } from 'react';
import type { UltronMode } from '../components/CalibrationView';

export type LiveVoiceStatus = 'disconnected' | 'connecting' | 'connected';

interface UseUltronLiveOptions {
  callsign: string;
  homeCity: string;
  mode: UltronMode;
  onUserTranscript?: (text: string) => void;
  onModelTranscript?: (text: string) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (message: string) => void;
}

function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[Math.min(idx, input.length - 1)];
    const s1 = input[Math.min(idx + 1, input.length - 1)];
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

function floatToPcm16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return float32;
}

export function useUltronLive({
  callsign,
  homeCity,
  mode,
  onUserTranscript,
  onModelTranscript,
  onSpeakingChange,
  onError,
}: UseUltronLiveOptions) {
  const [status, setStatus] = useState<LiveVoiceStatus>('disconnected');
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const wsKeepaliveRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const connectSeqRef = useRef(0);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Latest callbacks in refs to avoid stale closures inside audio/ws callbacks
  const callbacksRef = useRef({
    onUserTranscript,
    onModelTranscript,
    onSpeakingChange,
    onError,
  });
  callbacksRef.current = {
    onUserTranscript,
    onModelTranscript,
    onSpeakingChange,
    onError,
  };

  const stopPlaybackQueue = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
    setIsModelSpeaking(false);
    callbacksRef.current.onSpeakingChange?.(false);
  }, []);

  const disconnect = useCallback(() => {
    connectSeqRef.current += 1;
    activeRef.current = false;

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      sourceNodeRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    stopPlaybackQueue();

    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }

    if (outputAnalyserRef.current) {
      try {
        outputAnalyserRef.current.disconnect();
      } catch {
        // Ignore
      }
      outputAnalyserRef.current = null;
    }

    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }

    if (wsKeepaliveRef.current !== null) {
      window.clearInterval(wsKeepaliveRef.current);
      wsKeepaliveRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }

    setStatus('disconnected');
  }, [stopPlaybackQueue]);

  const schedulePcmChunk = useCallback((base64Audio: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const samples = base64Pcm16ToFloat32(base64Audio);
    if (samples.length === 0) return;

    const audioBuffer = ctx.createBuffer(1, samples.length, 24000);
    audioBuffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputAnalyserRef.current ?? ctx.destination);

    const now = ctx.currentTime;
    if (nextStartTimeRef.current < now) {
      nextStartTimeRef.current = now + 0.02;
    }
    const startAt = nextStartTimeRef.current;
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current.add(source);
    setIsModelSpeaking(true);
    callbacksRef.current.onSpeakingChange?.(true);

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setIsModelSpeaking(false);
        callbacksRef.current.onSpeakingChange?.(false);
      }
    };

    source.start(startAt);
  }, []);

  const connect = useCallback(async () => {
    if (activeRef.current || status === 'connecting') return;
    const mySeq = ++connectSeqRef.current;
    setStatus('connecting');

    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;

      let inputCtx: AudioContext;
      try {
        inputCtx = new Ctx({ sampleRate: 16000 });
      } catch {
        inputCtx = new Ctx();
      }
      let outputCtx: AudioContext;
      try {
        outputCtx = new Ctx({ sampleRate: 24000 });
      } catch {
        outputCtx = new Ctx();
      }

      const outputAnalyser = outputCtx.createAnalyser();
      outputAnalyser.fftSize = 64;
      outputAnalyser.smoothingTimeConstant = 0.72;
      outputAnalyser.connect(outputCtx.destination);

      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      outputAnalyserRef.current = outputAnalyser;
      nextStartTimeRef.current = outputCtx.currentTime;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (connectSeqRef.current !== mySeq) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      mediaStreamRef.current = stream;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({
        callsign: callsign || 'Architect',
        homeCity: homeCity || '',
        mode,
      });
      const ws = new WebSocket(`${protocol}//${window.location.host}/live?${params.toString()}`);
      wsRef.current = ws;
      activeRef.current = true;

      ws.onopen = () => {
        if (!activeRef.current || connectSeqRef.current !== mySeq) return;
        setStatus('connected');

        if (wsKeepaliveRef.current !== null) {
          window.clearInterval(wsKeepaliveRef.current);
        }
        wsKeepaliveRef.current = window.setInterval(() => {
          const sock = wsRef.current;
          if (sock && sock.readyState === WebSocket.OPEN) {
            sock.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20_000);

        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        sourceNodeRef.current = source;
        processorRef.current = processor;

        processor.onaudioprocess = (event) => {
          if (!activeRef.current) return;
          const sock = wsRef.current;
          if (!sock || sock.readyState !== WebSocket.OPEN) return;
          const rawChannel = event.inputBuffer.getChannelData(0);
          const channelData =
            inputCtx.sampleRate === 16000
              ? rawChannel
              : resampleLinear(rawChannel, inputCtx.sampleRate, 16000);
          const base64 = floatToPcm16Base64(channelData);
          sock.send(JSON.stringify({ audio: base64 }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            audio?: string;
            interrupted?: boolean;
            inputTranscript?: string;
            outputTranscript?: string;
            error?: string;
          };
          if (msg.type === 'pong') return;
          if (msg.error) {
            callbacksRef.current.onError?.(msg.error);
            disconnect();
            return;
          }
          if (msg.interrupted) {
            stopPlaybackQueue();
          }
          if (msg.audio) {
            schedulePcmChunk(msg.audio);
          }
          if (msg.inputTranscript) {
            callbacksRef.current.onUserTranscript?.(msg.inputTranscript);
          }
          if (msg.outputTranscript) {
            callbacksRef.current.onModelTranscript?.(msg.outputTranscript);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        callbacksRef.current.onError?.(
          'Live neural voice bridge encountered a connection fault.',
        );
        disconnect();
      };

      ws.onclose = () => {
        if (activeRef.current) {
          disconnect();
        }
      };
    } catch (err) {
      if (connectSeqRef.current === mySeq) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Microphone access or Live audio stream failed.';
        callbacksRef.current.onError?.(msg);
        disconnect();
      }
    }
  }, [callsign, disconnect, homeCity, mode, schedulePcmChunk, status, stopPlaybackQueue]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const getOutputAnalyser = useCallback(() => outputAnalyserRef.current, []);

  return {
    status,
    isModelSpeaking,
    connect,
    disconnect,
    getOutputAnalyser,
  };
}
