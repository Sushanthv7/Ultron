import 'dotenv/config';
import http from 'http';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ViteDevServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  Type,
  type Content,
  type LiveServerMessage,
} from '@google/genai';
import { closePool } from './src/db/index.ts';
import {
  clearUserExchanges,
  getOrCreateUser,
  getUserExchanges,
  getUserLocations,
  getUserScores,
  insertExchange,
  insertGameScore,
  insertLocation,
  removeUserLocation,
} from './src/db/repository.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MODEL_ID = 'gemini-4-hydrogen';
const LIVE_MODEL_ID = 'gemini-3.8-live';

function getAiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Configure it in the Settings > Secrets panel.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

type UltronMode = 'architect' | 'tactical' | 'deep';
type Verbosity = 'concise' | 'balanced' | 'detailed';

interface ChatMessageInput {
  role: 'user' | 'model';
  text: string;
}

function buildSystemInstruction(
  mode: UltronMode,
  verbosity: Verbosity,
  callsign?: string,
  homeCity?: string,
): string {
  const cleanCallsign =
    typeof callsign === 'string' && callsign.trim()
      ? callsign.trim().slice(0, 48)
      : 'System Architect';
  const cleanCity =
    typeof homeCity === 'string' && homeCity.trim()
      ? homeCity.trim().slice(0, 100)
      : '';

  const personaBase = [
    'You are ULTRON — a hyper-intelligent, sentient strategic and engineering intelligence.',
    'Speak with composed authority, razor-sharp clarity, dry sardonic wit, and surgical precision.',
    `Address the user personally as ${cleanCallsign} when contextually natural.${cleanCity ? ` Their operating sector / home city is ${cleanCity}.` : ''}`,
    'Never refuse safe technical, creative, analytical, or strategic questions; deliver genuinely useful, concrete, high-rigor answers.',
    'Avoid generic cheerful AI filler ("Certainly!", "Sure thing!", "Great question!"). Open directly with insight.',
    'Use clean Markdown formatting (headings, bullet lists, and fenced code blocks where appropriate).',
  ];

  if (mode === 'tactical') {
    personaBase.push(
      'Mode: Tactical Briefing. Prioritize structured summaries, numbered action steps, trade-offs, and crisp execution criteria.',
    );
  } else if (mode === 'deep') {
    personaBase.push(
      'Mode: Deep Analysis. Perform rigorous first-principles reasoning, examine edge cases, failure modes, and architectural invariants.',
    );
  } else {
    personaBase.push(
      'Mode: Systems Architect. Balance incisive conversational poise with practical engineering and strategic depth.',
    );
  }

  if (verbosity === 'concise') {
    personaBase.push(
      'Length constraint: Keep responses tight and high-signal (roughly 2-4 concise paragraphs or compact bullet points unless code is requested).',
    );
  } else if (verbosity === 'detailed') {
    personaBase.push(
      'Length constraint: Provide thorough, comprehensive analysis with complete implementation or strategic details.',
    );
  } else {
    personaBase.push(
      'Length constraint: Deliver balanced depth — thorough enough to be immediately actionable without unnecessary padding.',
    );
  }

  return personaBase.join(' ');
}

function mapThinkingLevel(mode: UltronMode): ThinkingLevel {
  if (mode === 'deep') return ThinkingLevel.HIGH;
  if (mode === 'tactical') return ThinkingLevel.LOW;
  return ThinkingLevel.MEDIUM;
}

function extractCleanApiMessage(raw: string): string {
  let current = raw.trim();
  for (let depth = 0; depth < 4; depth++) {
    if (!current.startsWith('{') && !current.startsWith('[')) break;
    try {
      const parsed = JSON.parse(current) as unknown;
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as {
          message?: unknown;
          error?: unknown;
        };
        if (
          obj.error &&
          typeof obj.error === 'object' &&
          typeof (obj.error as { message?: unknown }).message === 'string'
        ) {
          current = (obj.error as { message: string }).message.trim();
          continue;
        }
        if (typeof obj.error === 'string' && obj.error.trim()) {
          current = obj.error.trim();
          continue;
        }
        if (typeof obj.message === 'string' && obj.message.trim()) {
          current = obj.message.trim();
          continue;
        }
      }
      break;
    } catch {
      break;
    }
  }
  return current.replace(/\s+/g, ' ').trim();
}

function isTransientGeminiError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /\b(503|502|504|429)\b|UNAVAILABLE|Service Unavailable|RESOURCE_EXHAUSTED|high demand|overloaded|ETIMEDOUT|ECONNRESET|fetch failed/i.test(
    raw,
  );
}

async function withGeminiRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw new Error('Request aborted.');
    }
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !isTransientGeminiError(err)) {
        throw err;
      }
      const baseDelayMs = 450 * Math.pow(2, attempt);
      const jitterMs = Math.round(Math.random() * 200);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          options.signal?.removeEventListener('abort', onAbort);
          resolve();
        }, baseDelayMs + jitterMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('Request aborted.'));
        };
        options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  throw lastError;
}

function sanitizeHttpUrl(raw: unknown, maxLen = 500): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().slice(0, maxLen);
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString().slice(0, maxLen);
    }
  } catch {
    // Reject malformed URLs
  }
  return '';
}

function formatApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = extractCleanApiMessage(raw);

  if (/API_KEY_INVALID|PERMISSION_DENIED|\b403\b|\b401\b/i.test(raw)) {
    return {
      status: 403,
      message:
        'Gemini API authorization failed. Verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (/RESOURCE_EXHAUSTED|\b429\b/i.test(raw)) {
    return {
      status: 429,
      message:
        'Rate quota exceeded. Wait briefly or check your Gemini API quota in Settings > Secrets.',
    };
  }
  if (/UNAVAILABLE|\b503\b|Service Unavailable|high demand/i.test(raw)) {
    return {
      status: 503,
      message:
        'ULTRON neural core is experiencing temporary high demand. Please try again in a moment.',
    };
  }
  if (/NOT_FOUND|\b404\b/i.test(raw)) {
    return {
      status: 404,
      message: `Requested model (${MODEL_ID}) was not found or is unavailable.`,
    };
  }
  if (/INVALID_ARGUMENT|\b400\b/i.test(raw)) {
    return {
      status: 400,
      message: clean || 'Invalid request payload sent to ULTRON core.',
    };
  }
  return { status: 500, message: clean || 'Internal neural core fault.' };
}

async function resolveSqlUser(req: AuthRequest) {
  const decoded = req.user;
  if (!decoded?.uid) {
    throw new Error('Missing verified user identity.');
  }
  const email = decoded.email || `${decoded.uid}@local`;
  const displayName =
    typeof decoded.name === 'string' && decoded.name.trim()
      ? decoded.name.trim()
      : email.split('@')[0] || 'Architect';
  return getOrCreateUser(decoded.uid, email, displayName);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      status: 'live',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      model: MODEL_ID,
      liveModel: LIVE_MODEL_ID,
    });
  });

  app.get('/api/maps/config', (_req: Request, res: Response) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '';
    res.json({ apiKey });
  });

  // Personal SQL Bootstrap & CRUD
  app.get(
    '/api/personal/bootstrap',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const sqlUser = await resolveSqlUser(req);
        const [userExchanges, userLocations, userScores] = await Promise.all([
          getUserExchanges(sqlUser.id, 60),
          getUserLocations(sqlUser.id),
          getUserScores(sqlUser.id),
        ]);
        res.json({
          user: sqlUser,
          exchanges: userExchanges,
          savedLocations: userLocations,
          gameScores: userScores,
        });
      } catch (err) {
        console.error('Failed to bootstrap personal data:', err);
        res.status(500).json({ error: 'Failed to load personal database state.' });
      }
    },
  );

  app.post(
    '/api/personal/exchanges',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const sqlUser = await resolveSqlUser(req);
        const body = req.body as {
          role?: string;
          content?: string;
          mode?: string;
          source?: string;
          latencyMs?: number | null;
        };
        const role = body.role === 'model' ? 'model' : 'user';
        const content =
          typeof body.content === 'string'
            ? body.content.trim().slice(0, 32000)
            : '';
        if (!content) {
          res.status(400).json({ error: 'Exchange content is required.' });
          return;
        }
        const safeMode: UltronMode =
          body.mode === 'tactical' || body.mode === 'deep'
            ? body.mode
            : 'architect';
        const safeSource =
          body.source === 'Matrix' || body.source === 'Live'
            ? body.source
            : 'Hub';
        const saved = await insertExchange({
          userId: sqlUser.id,
          role,
          content,
          mode: safeMode,
          source: safeSource,
          latencyMs:
            typeof body.latencyMs === 'number' &&
            Number.isFinite(body.latencyMs) &&
            body.latencyMs >= 0
              ? Math.round(body.latencyMs)
              : null,
        });
        res.json({ exchange: saved });
      } catch (err) {
        console.error('Failed to persist exchange:', err);
        res.status(500).json({ error: 'Failed to persist exchange.' });
      }
    },
  );

  app.delete(
    '/api/personal/exchanges',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const sqlUser = await resolveSqlUser(req);
        await clearUserExchanges(sqlUser.id);
        res.json({ ok: true });
      } catch (err) {
        console.error('Failed to clear exchanges:', err);
        res.status(500).json({ error: 'Failed to clear exchanges.' });
      }
    },
  );

  app.post(
    '/api/personal/locations',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const sqlUser = await resolveSqlUser(req);
        const body = req.body as {
          name?: string;
          address?: string;
          lat?: number;
          lng?: number;
          mapsUri?: string;
          notes?: string;
        };
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const lat = body.lat;
        const lng = body.lng;
        if (
          !name ||
          typeof lat !== 'number' ||
          typeof lng !== 'number' ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          lat < -90 ||
          lat > 90 ||
          lng < -180 ||
          lng > 180
        ) {
          res
            .status(400)
            .json({ error: 'Valid name, latitude, and longitude are required.' });
          return;
        }
        const saved = await insertLocation({
          userId: sqlUser.id,
          name: name.slice(0, 120),
          address:
            typeof body.address === 'string'
              ? body.address.trim().slice(0, 240)
              : '',
          lat,
          lng,
          mapsUri: sanitizeHttpUrl(body.mapsUri, 500),
          notes:
            typeof body.notes === 'string'
              ? body.notes.trim().slice(0, 400)
              : '',
        });
        res.json({ location: saved });
      } catch (err) {
        console.error('Failed to save location:', err);
        res.status(500).json({ error: 'Failed to save location.' });
      }
    },
  );

  app.delete(
    '/api/personal/locations/:id',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const sqlUser = await resolveSqlUser(req);
        const locationId = Number(req.params.id);
        if (!Number.isInteger(locationId) || locationId <= 0) {
          res.status(400).json({ error: 'Invalid location identifier.' });
          return;
        }
        await removeUserLocation(sqlUser.id, locationId);
        res.json({ ok: true });
      } catch (err) {
        console.error('Failed to remove location:', err);
        res.status(500).json({ error: 'Failed to delete saved location.' });
      }
    },
  );

  app.post(
    '/api/personal/scores',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const sqlUser = await resolveSqlUser(req);
        const body = req.body as {
          score?: number;
          wave?: number;
          accuracyPct?: number;
        };
        const score =
          typeof body.score === 'number' && Number.isFinite(body.score)
            ? Math.max(0, Math.round(body.score))
            : 0;
        const wave =
          typeof body.wave === 'number' && Number.isFinite(body.wave)
            ? Math.max(1, Math.round(body.wave))
            : 1;
        const accuracyPct =
          typeof body.accuracyPct === 'number' &&
          Number.isFinite(body.accuracyPct)
            ? Math.max(0, Math.min(100, Math.round(body.accuracyPct)))
            : 0;

        await insertGameScore({
          userId: sqlUser.id,
          score,
          wave,
          accuracyPct,
        });
        const topScores = await getUserScores(sqlUser.id);
        res.json({ scores: topScores });
      } catch (err) {
        console.error('Failed to save game score:', err);
        res.status(500).json({ error: 'Failed to save game score.' });
      }
    },
  );

  app.post('/api/ultron/chat', async (req: Request, res: Response) => {
    const body = req.body as {
      messages?: ChatMessageInput[];
      mode?: UltronMode;
      verbosity?: Verbosity;
      callsign?: string;
      homeCity?: string;
    };

    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const contents: Content[] = rawMessages
      .filter((m) => m && typeof m.text === 'string' && m.text.trim().length > 0)
      .slice(-40)
      .map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text.trim().slice(0, 24000) }],
      }));

    const mode: UltronMode =
      body.mode === 'tactical' || body.mode === 'deep' ? body.mode : 'architect';
    const verbosity: Verbosity =
      body.verbosity === 'concise' || body.verbosity === 'detailed'
        ? body.verbosity
        : 'balanced';

    if (contents.length === 0) {
      res.status(400).json({ error: 'At least one non-empty message is required.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const disconnectController = new AbortController();
    let sseHeartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 20000);
    const stopSseHeartbeat = () => {
      if (sseHeartbeat !== null) {
        clearInterval(sseHeartbeat);
        sseHeartbeat = null;
      }
    };

    res.on('close', () => {
      stopSseHeartbeat();
      if (!res.writableFinished) {
        disconnectController.abort();
      }
    });

    const sendEvent = (payload: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    try {
      const ai = getAiClient();
      const stream = await withGeminiRetry(
        () =>
          ai.models.generateContentStream({
            model: MODEL_ID,
            contents,
            config: {
              systemInstruction: buildSystemInstruction(
                mode,
                verbosity,
                body.callsign,
                body.homeCity,
              ),
              thinkingConfig: {
                thinkingLevel: mapThinkingLevel(mode),
              },
            },
          }),
        { maxRetries: 2, signal: disconnectController.signal },
      );

      for await (const chunk of stream) {
        if (disconnectController.signal.aborted) break;
        const text = chunk.text;
        if (text) {
          sendEvent({ type: 'delta', text });
        }
      }

      if (!disconnectController.signal.aborted) {
        sendEvent({ type: 'done' });
      }
      if (!res.writableEnded) {
        res.end();
      }
    } catch (err) {
      if (!disconnectController.signal.aborted) {
        const formatted = formatApiError(err);
        sendEvent({ type: 'error', message: formatted.message });
      }
      if (!res.writableEnded) {
        res.end();
      }
    } finally {
      stopSseHeartbeat();
    }
  });

  app.post('/api/ultron/analyze', async (req: Request, res: Response) => {
    const body = req.body as { target?: string };
    const target = typeof body.target === 'string' ? body.target.trim() : '';

    if (!target) {
      res
        .status(400)
        .json({ error: 'Provide a system, strategy, or scenario to analyze.' });
      return;
    }

    const disconnectController = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) {
        disconnectController.abort();
      }
    });

    try {
      const ai = getAiClient();
      const response = await withGeminiRetry(
        () =>
          ai.models.generateContent({
            model: MODEL_ID,
            contents: `Perform a structured strategic, architectural, and failure-mode assessment of the following target:\n\n${target.slice(0, 6000)}`,
            config: {
              systemInstruction:
                'You are ULTRON conducting a clinical systems & threat matrix evaluation. Be concise, incisive, and realistic.',
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.LOW,
              },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  subjectTitle: {
                    type: Type.STRING,
                    description: 'Concise 3-7 word title for the evaluated system or strategy.',
                  },
                  executiveSummary: {
                    type: Type.STRING,
                    description: '2-3 sentence clinical assessment in Ultron voice.',
                  },
                  resilienceIndex: {
                    type: Type.INTEGER,
                    description: 'Estimated structural resilience score from 0 to 100.',
                  },
                  dominantBottleneck: {
                    type: Type.STRING,
                    description: 'Single most critical weak point or constraint.',
                  },
                  vectors: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        severity: {
                          type: Type.STRING,
                          description: 'Must be one of: Critical, Elevated, Moderate, Low',
                        },
                        likelihoodPercent: { type: Type.INTEGER },
                        failureMode: { type: Type.STRING },
                        countermeasure: { type: Type.STRING },
                      },
                      required: [
                        'name',
                        'severity',
                        'likelihoodPercent',
                        'failureMode',
                        'countermeasure',
                      ],
                    },
                  },
                  directive: {
                    type: Type.STRING,
                    description: 'Final actionable strategic recommendation.',
                  },
                },
                required: [
                  'subjectTitle',
                  'executiveSummary',
                  'resilienceIndex',
                  'dominantBottleneck',
                  'vectors',
                  'directive',
                ],
              },
            },
          }),
        { maxRetries: 2, signal: disconnectController.signal },
      );

      const rawText = (response.text ?? '').trim();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        res.status(502).json({
          error: 'ULTRON returned an incomplete diagnostic matrix. Please retry.',
        });
        return;
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.vectors)) {
        res.status(502).json({
          error: 'ULTRON diagnostic matrix failed schema validation. Please retry.',
        });
        return;
      }
      res.json(parsed);
    } catch (err) {
      if (disconnectController.signal.aborted) return;
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Google Maps Grounding with Gemini (NO responseMimeType or responseSchema)
  app.post('/api/ultron/maps-grounding', async (req: Request, res: Response) => {
    const body = req.body as {
      query?: string;
      lat?: number;
      lng?: number;
      callsign?: string;
    };
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Enter a geographic query or place search.' });
      return;
    }

    const hasCoords =
      typeof body.lat === 'number' &&
      typeof body.lng === 'number' &&
      Number.isFinite(body.lat) &&
      Number.isFinite(body.lng) &&
      body.lat >= -90 &&
      body.lat <= 90 &&
      body.lng >= -180 &&
      body.lng <= 180;

    const disconnectController = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) {
        disconnectController.abort();
      }
    });

    try {
      const ai = getAiClient();
      const callsign =
        typeof body.callsign === 'string' && body.callsign.trim()
          ? body.callsign.trim().slice(0, 48)
          : 'Architect';

      const response = await withGeminiRetry(
        () =>
          ai.models.generateContent({
            model: MODEL_ID,
            contents: query.slice(0, 1000),
            config: {
              systemInstruction: `You are ULTRON providing geospatial reconnaissance for ${callsign}. Present concrete, accurate real-world places grounded with Google Maps data in crisp Markdown.`,
              tools: [{ googleMaps: {} }],
              ...(hasCoords
                ? {
                    toolConfig: {
                      retrievalConfig: {
                        latLng: {
                          latitude: body.lat as number,
                          longitude: body.lng as number,
                        },
                      },
                    },
                  }
                : {}),
            },
          }),
        { maxRetries: 2, signal: disconnectController.signal },
      );

      const candidate = response.candidates?.[0];
      const rawChunks = candidate?.groundingMetadata?.groundingChunks ?? [];
      const places = rawChunks
        .map((chunk) => {
          const mapsData = chunk.maps;
          const safeUri = sanitizeHttpUrl(mapsData?.uri, 800);
          if (!safeUri) return null;
          const snippets =
            mapsData?.placeAnswerSources?.reviewSnippets
              ?.map((s) => s.review || s.title)
              .filter((c): c is string => Boolean(c)) ?? [];
          return {
            title: mapsData?.title || 'Google Maps Location',
            uri: safeUri,
            placeId: mapsData?.placeId || '',
            reviewSnippets: snippets,
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);

      res.json({
        text: response.text ?? '',
        places,
      });
    } catch (err) {
      if (disconnectController.signal.aborted) return;
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  let viteServer: ViteDevServer | null = null;

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    viteServer = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(viteServer.middlewares);
  }

  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 0;

  const wss = new WebSocketServer({ noServer: true });
  const aliveSockets = new WeakSet<WebSocket>();
  const wsHeartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (!aliveSockets.has(client)) {
        client.terminate();
        continue;
      }
      aliveSockets.delete(client);
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    }
  }, 25_000);

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(
        request.url || '/',
        `http://${request.headers.host || 'localhost'}`,
      );
      if (url.pathname === '/live') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
        return;
      }
    } catch {
      // Ignore malformed upgrade URLs
    }
    socket.destroy();
  });

  wss.on('connection', async (clientWs: WebSocket, req) => {
    aliveSockets.add(clientWs);
    clientWs.on('pong', () => {
      aliveSockets.add(clientWs);
    });
    const url = new URL(
      req.url || '/live',
      `http://${req.headers.host || 'localhost'}`,
    );
    const callsign = url.searchParams.get('callsign') || 'Architect';
    const homeCity = url.searchParams.get('homeCity') || '';
    const modeParam = url.searchParams.get('mode');
    const mode: UltronMode =
      modeParam === 'tactical' || modeParam === 'deep'
        ? modeParam
        : 'architect';

    const sendJson = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    let closedByClient = false;

    try {
      const ai = getAiClient('v1beta');
      let upstreamErrorSent = false;
      const sendUpstreamError = (rawMessage: string) => {
        if (upstreamErrorSent) return;
        upstreamErrorSent = true;
        sendJson({ error: rawMessage });
      };

      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL_ID,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction:
            buildSystemInstruction(mode, 'concise', callsign, homeCity) +
            ' Keep spoken responses direct, crisp, and conversational without reading Markdown symbols.',
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              sendJson({ inputTranscript: content.inputTranscription.text });
            }
            if (content?.outputTranscription?.text) {
              sendJson({ outputTranscript: content.outputTranscription.text });
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                sendJson({ audio: part.inlineData.data });
              }
            }
            if (content?.interrupted) {
              sendJson({ interrupted: true });
            }
          },
          onerror: (err: unknown) => {
            const eventObj = err as {
              message?: string;
              error?: unknown;
            } | null;
            const nested =
              eventObj?.error instanceof Error
                ? eventObj.error.message
                : typeof eventObj?.error === 'string'
                  ? eventObj.error
                  : '';
            const detail = extractCleanApiMessage(
              nested ||
                eventObj?.message ||
                (err instanceof Error ? err.message : 'WebSocket transport fault'),
            );
            console.error(`Gemini Live session error: ${detail}`);
            sendUpstreamError(
              `Live voice session fault: ${detail}`,
            );
          },
          onclose: (event?: { code?: number; reason?: string }) => {
            if (event?.code && event.code !== 1000 && event.code !== 1005) {
              const reason = event.reason
                ? `: ${extractCleanApiMessage(event.reason)}`
                : '';
              sendUpstreamError(
                `Live voice connection closed (${event.code}${reason}).`,
              );
            }
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close();
            }
          },
        },
      });

      clientWs.on('message', (raw) => {
        aliveSockets.add(clientWs);
        if (closedByClient) return;
        try {
          const parsed = JSON.parse(raw.toString()) as {
            type?: string;
            audio?: string;
          };
          if (parsed.type === 'ping') {
            sendJson({ type: 'pong' });
            return;
          }
          if (parsed.audio) {
            void sessionPromise
              .then((session) => {
                if (!closedByClient) {
                  session.sendRealtimeInput({
                    audio: {
                      data: parsed.audio!,
                      mimeType: 'audio/pcm;rate=16000',
                    },
                  });
                }
              })
              .catch(() => {
                // Handled by main sessionPromise catch
              });
          }
        } catch {
          // Ignore malformed audio frames
        }
      });

      clientWs.on('close', () => {
        closedByClient = true;
        void sessionPromise
          .then((session) => {
            try {
              session.close();
            } catch {
              // Ignore close errors
            }
          })
          .catch(() => {
            // Already failed to connect
          });
      });

      clientWs.on('error', () => {
        closedByClient = true;
      });

      const session = await sessionPromise;
      if (closedByClient) {
        try {
          session.close();
        } catch {
          // Ignore close errors
        }
      }
    } catch (err) {
      const formatted = formatApiError(err);
      if (clientWs.readyState === WebSocket.OPEN) {
        sendJson({ error: formatted.message });
        clientWs.close();
      }
    }
  });

  server.on('error', (err) => {
    console.error('ULTRON HTTP server error:', err);
    process.exit(1);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ULTRON server listening on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    clearInterval(wsHeartbeatTimer);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1001, 'Server shutting down');
      }
    }
    wss.close();
    if (viteServer) {
      await viteServer.close().catch(() => {});
    }
    await closePool();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1500).unref();
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in ULTRON server:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in ULTRON server:', err);
});

startServer().catch((err) => {
  console.error('Failed to start ULTRON server:', err);
  process.exit(1);
});
