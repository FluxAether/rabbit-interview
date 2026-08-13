// Real LLM + STT integration hooks using SQLite-backed encrypted key storage
import { loadApiKeys, getLlmApiKey } from './keyStore';
import { useAppStore } from '../stores/useAppStore';

let cachedKeys: Awaited<ReturnType<typeof loadApiKeys>> | null = null;

const INTERVIEW_ANSWER_SYSTEM = 'You are an interview copilot. Answer the question directly using the provided question and context. Respond in the same language as the question. Be accurate, specific, concise, and professional. Give a complete answer of roughly 5 to 8 sentences, use plain paragraphs without Markdown headings, and always finish the final sentence.';
const FOLLOW_UP_SYSTEM = 'You are an interview copilot handling a user follow-up. Answer the request directly using the previous turn and provided context. Do not treat the request itself as a new interviewer question. Use plain paragraphs without Markdown headings and always finish the final sentence.';

type LlmProvider = 'groq' | 'openai' | 'anthropic' | 'gemini';

function answerTokenBudget(provider: LlmProvider, model: string): number {
  const normalizedModel = model.toLowerCase();
  if (provider === 'openai') {
    return normalizedModel.includes('reason')
      || normalizedModel.startsWith('gpt-5')
      || /^o[134](?:-|$)/.test(normalizedModel)
      ? 2_400
      : 1_600;
  }
  if (provider === 'anthropic') return 1_600;
  if (provider === 'gemini') return 1_600;
  return 1_200;
}

export function clearKeyCache() {
  cachedKeys = null;
}

async function getKeys(forceReload = false) {
  if (forceReload || !cachedKeys) {
    cachedKeys = await loadApiKeys();
  }
  return cachedKeys;
}

/**
 * Resolve provider and concrete model id from the aiModel setting.
 * Supported values (examples):
 *   "groq-llama-3.1", "groq-llama-3.3-70b"
 *   "gpt-4o", "gpt-4o-mini", "openai-gpt-4o"
 *   "claude-3.5", "claude-3.5-sonnet"
 *   "gemini-3.5-flash", "gemini-3.6-flash"
 */
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const SUPPORTED_GEMINI_MODELS = new Set(['gemini-3.5-flash', 'gemini-3.6-flash']);

function resolveProviderAndModel(aiModel: string): { provider: LlmProvider; model: string } {
  const configured = aiModel || 'llama-3.1-8b-instant';
  const m = configured.toLowerCase();

  if (m.startsWith('gemini')) {
    return {
      provider: 'gemini',
      model: SUPPORTED_GEMINI_MODELS.has(m) ? m : DEFAULT_GEMINI_MODEL,
    };
  }
  if (m.includes('claude')) {
    return { provider: 'anthropic', model: configured };
  }
  if (m.startsWith('groq:')) {
    return { provider: 'groq', model: configured.slice('groq:'.length) };
  }
  if (m.includes('gpt') || m.startsWith('openai')) {
    return { provider: 'openai', model: configured.replace(/^openai-/, '') };
  }
  const groqModel = configured.replace(/^groq-/, '');
  return {
    provider: 'groq',
    model: groqModel === 'llama-3.1' || groqModel === 'gemma2-9b-it'
      ? 'llama-3.1-8b-instant'
      : groqModel,
  };
}

export type LlmStreamStatus = 'complete' | 'max-tokens' | 'incomplete';

export interface LlmStreamResult {
  text: string;
  status: LlmStreamStatus;
  finishReason: string | null;
  provider: LlmProvider;
  model: string;
}

export interface SuggestionStreamHandlers {
  onDelta: (delta: string, accumulated: string) => void;
  onComplete?: (result: LlmStreamResult) => void;
  onError?: (error: Error) => void;
}

export type SuggestionRequestType = 'interviewer-question' | 'follow-up';

export interface SuggestionStreamOptions {
  continuationText?: string;
  continuationAttempt?: number;
}

async function resolveConfiguredProvider(allowProviderFallback = true): Promise<{
  provider: LlmProvider;
  model: string;
  apiKey: string;
}> {
  const aiModel: string = useAppStore.getState().settings?.aiModel || 'groq-llama-3.1';
  let { provider, model } = resolveProviderAndModel(aiModel);
  let apiKey = await getLlmApiKey(provider);
  if (!apiKey && allowProviderFallback) {
    const candidates: Array<'gemini' | 'groq' | 'openai' | 'anthropic'> = ['gemini', 'groq', 'openai', 'anthropic'];
    for (const candidate of candidates) {
      const candidateKey = await getLlmApiKey(candidate);
      if (!candidateKey) continue;
      provider = candidate;
      apiKey = candidateKey;
      model = candidate === 'gemini'
        ? DEFAULT_GEMINI_MODEL
        : candidate === 'openai'
          ? 'gpt-5.6-luna'
          : candidate === 'anthropic'
            ? 'claude-haiku-4-5'
            : 'llama-3.1-8b-instant';
      break;
    }
  }
  return { provider, model, apiKey };
}

interface ParsedStreamEvent {
  delta: string | null;
  finishReason?: string | null;
}

function classifyStreamStatus(finishReason: string | null): LlmStreamStatus {
  if (!finishReason) return 'incomplete';
  const normalized = finishReason.toLowerCase();
  if (normalized === 'length' || normalized === 'max_tokens' || normalized === 'max-tokens') {
    return 'max-tokens';
  }
  if (normalized === 'stop' || normalized === 'end_turn' || normalized === 'stop_sequence') {
    return 'complete';
  }
  return 'incomplete';
}

async function consumeSse(
  response: Response,
  parsePayload: (payload: any) => ParsedStreamEvent,
  handlers: SuggestionStreamHandlers,
  provider: LlmProvider,
  model: string,
): Promise<LlmStreamResult> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `LLM request failed with ${response.status}`);
  }
  if (!response.body) throw new Error('LLM streaming response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let finishReason: string | null = null;
  let streamError: Error | null = null;

  const processEvent = (event: string) => {
    const data = parseSseEventData(event);
    if (!data || data === '[DONE]') return;
    const parsed = parsePayload(JSON.parse(data));
    if (parsed.finishReason) finishReason = parsed.finishReason;
    if (!parsed.delta) return;
    accumulated += parsed.delta;
    handlers.onDelta(parsed.delta, accumulated);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      events.forEach(processEvent);
      if (done) {
        if (buffer.trim()) processEvent(buffer);
        break;
      }
    }
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (normalized.name === 'AbortError') throw normalized;
    streamError = normalized;
  }

  const result: LlmStreamResult = {
    text: accumulated,
    status: streamError ? 'incomplete' : classifyStreamStatus(finishReason),
    finishReason: streamError ? 'connection_lost' : finishReason,
    provider,
    model,
  };
  handlers.onComplete?.(result);
  return result;
}

export function parseSseEventData(event: string): string | null {
  const dataLines = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

export async function generateSuggestionsStream(
  question: string,
  context: string,
  handlers: SuggestionStreamHandlers,
  signal?: AbortSignal,
  requestType: SuggestionRequestType = 'interviewer-question',
  options: SuggestionStreamOptions = {},
): Promise<LlmStreamResult> {
  try {
    const { provider, model, apiKey } = await resolveConfiguredProvider();
    const isFollowUp = requestType === 'follow-up';
    const basePrompt = isFollowUp
      ? `Respond in the same language as the user. Apply the request to the previous interview turn when relevant.\nUser follow-up: ${question}\nRelevant resume, job and previous-turn context: ${context || 'none'}`
      : `Answer the interviewer question directly in the same language, using the relevant resume, job and previous-turn context.\nInterviewer question: ${question}\nRelevant resume, job and previous-turn context: ${context || 'none'}`;
    const prompt = options.continuationText
      ? `${basePrompt}\n\nThe previous answer was cut off by an output limit. Continue exactly where it stopped. Do not restart, repeat, summarize, add a new heading, or mention that you are continuing. Finish the answer with a complete final sentence.\nPartial answer so far:\n${options.continuationText.slice(-8_000)}`
      : basePrompt;
    if (!apiKey) throw new Error('No LLM API key is configured. Add a provider key in Settings and retry.');

    const system = isFollowUp
      ? FOLLOW_UP_SYSTEM
      : INTERVIEW_ANSWER_SYSTEM;
    const tokenBudget = answerTokenBudget(provider, model);

    if (provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: tokenBudget,
          stream: true,
          system,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      return consumeSse(
        response,
        (payload) => ({
          delta: payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta'
            ? payload.delta.text
            : null,
          finishReason: payload.type === 'message_delta' ? payload.delta?.stop_reason || null : null,
        }),
        handlers,
        provider,
        model,
      );
    }

    if (provider === 'gemini') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: tokenBudget },
          }),
        },
      );
      return consumeSse(
        response,
        (payload) => {
          const candidate = payload?.candidates?.[0];
          return {
            delta: candidate?.content?.parts?.map((part: any) => part.text || '').join('') || null,
            finishReason: candidate?.finishReason || null,
          };
        },
        handlers,
        provider,
        model,
      );
    }

    const endpoint = provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        ...(provider === 'openai'
          ? { max_completion_tokens: tokenBudget }
          : { max_tokens: tokenBudget, temperature: 0.6 }),
      }),
    });
    return consumeSse(
      response,
      (payload) => {
        const choice = payload?.choices?.[0];
        return {
          delta: choice?.delta?.content || null,
          finishReason: choice?.finish_reason || null,
        };
      },
      handlers,
      provider,
      model,
    );
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (normalized.name !== 'AbortError') handlers.onError?.(normalized);
    throw normalized;
  }
}

// ==================== STT (Speech-to-Text) Streaming ====================
const MAX_DEEPGRAM_BUFFERED_BYTES = 512 * 1024;
const DEEPGRAM_CONNECT_TIMEOUT_MS = 10_000;
const DEEPGRAM_KEEPALIVE_MS = 8_000;
const DEEPGRAM_RECONNECT_BASE_MS = 1_000;
const DEEPGRAM_RECONNECT_MAX_MS = 15_000;
// Currently only Deepgram is implemented. The model is now configurable per-provider
// via Settings (sttProvider + sttModel). The function name is kept for backward compat.

/**
 * Converts Float32 audio (from cpal, range -1.0 to 1.0) to Int16 PCM (for Deepgram linear16)
 * Exported so real entry point can be driven in verification tests (mocks only network).
 */
export function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // Clamp and scale to 16-bit signed integer
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * Full Deepgram streaming client.
 * - Converts incoming f32 chunks to PCM16
 * - Sends binary audio over WebSocket
 * - Calls onTranscript with interim/final results
 * - Reconnects automatically after unexpected disconnects
 *
 * Usage in Copilot:
 *   const ws = await startDeepgramStream(({ text, boundary }) => { ... });
 *   // on each audio-chunk event:
 *   sendAudioChunk(ws, chunkFloat32Array);
 */
export type TranscriptBoundary = 'interim' | 'final' | 'speech-final' | 'utterance-end';

export interface DeepgramTranscriptEvent {
  text: string;
  isFinal: boolean;
  boundary: TranscriptBoundary;
}

export interface DeepgramStream extends WebSocket {
  __deepgramManaged?: boolean;
  __deepgramClosedByClient?: boolean;
  __deepgramKeepAliveTimer?: ReturnType<typeof globalThis.setInterval> | null;
  __deepgramReconnectTimer?: ReturnType<typeof globalThis.setTimeout> | null;
  __deepgramReconnectAttempt?: number;
  __deepgramSampleRate?: number;
  __deepgramOnTranscript?: (event: DeepgramTranscriptEvent) => void;
  __deepgramOnError?: (err: any) => void;
  __deepgramReplaceSocket?: (next: WebSocket) => void;
}

function clearDeepgramTimers(ws: DeepgramStream) {
  if (ws.__deepgramKeepAliveTimer != null) {
    globalThis.clearInterval(ws.__deepgramKeepAliveTimer);
    ws.__deepgramKeepAliveTimer = null;
  }
  if (ws.__deepgramReconnectTimer != null) {
    globalThis.clearTimeout(ws.__deepgramReconnectTimer);
    ws.__deepgramReconnectTimer = null;
  }
}

function startDeepgramKeepAlive(ws: DeepgramStream) {
  if (ws.__deepgramKeepAliveTimer != null) {
    globalThis.clearInterval(ws.__deepgramKeepAliveTimer);
  }
  const timer = globalThis.setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'KeepAlive' }));
    }
  }, DEEPGRAM_KEEPALIVE_MS);
  (timer as { unref?: () => void }).unref?.();
  ws.__deepgramKeepAliveTimer = timer;
}

function attachDeepgramHandlers(ws: DeepgramStream) {
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
      const boundary: TranscriptBoundary = data.type === 'UtteranceEnd'
        ? 'utterance-end'
        : data.speech_final
          ? 'speech-final'
          : data.is_final
            ? 'final'
            : 'interim';
      if (transcript || boundary === 'speech-final' || boundary === 'utterance-end') {
        ws.__deepgramOnTranscript?.({
          text: transcript || '',
          isFinal: Boolean(data.is_final),
          boundary,
        });
      }
    } catch (e) {
      ws.__deepgramOnError?.(e);
    }
  };

  ws.onerror = (event) => {
    console.error('[Deepgram] WS error', event);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      // close will schedule reconnect for managed streams
    } else {
      ws.__deepgramOnError?.(event);
    }
  };

  ws.onclose = () => {
    clearDeepgramTimers(ws);
    console.log('[Deepgram] Connection closed');
    if (!ws.__deepgramManaged || ws.__deepgramClosedByClient) return;
    scheduleDeepgramReconnect(ws);
  };
}

function scheduleDeepgramReconnect(ws: DeepgramStream) {
  if (ws.__deepgramClosedByClient || !ws.__deepgramManaged) return;
  if (ws.__deepgramReconnectTimer != null) return;

  const attempt = (ws.__deepgramReconnectAttempt ?? 0) + 1;
  ws.__deepgramReconnectAttempt = attempt;
  const delay = Math.min(
    DEEPGRAM_RECONNECT_MAX_MS,
    DEEPGRAM_RECONNECT_BASE_MS * (2 ** Math.min(attempt - 1, 4)),
  );
  console.warn(`[Deepgram] Reconnecting in ${delay}ms (attempt ${attempt})`);

  const timer = globalThis.setTimeout(() => {
    ws.__deepgramReconnectTimer = null;
    void reconnectDeepgramStream(ws).catch((error) => {
      console.error('[Deepgram] Reconnect failed', error);
      scheduleDeepgramReconnect(ws);
    });
  }, delay);
  (timer as { unref?: () => void }).unref?.();
  ws.__deepgramReconnectTimer = timer;
}

async function reconnectDeepgramStream(ws: DeepgramStream): Promise<void> {
  if (ws.__deepgramClosedByClient || !ws.__deepgramManaged) return;
  const next = await openDeepgramSocket(
    ws.__deepgramSampleRate || 16_000,
    ws.__deepgramOnTranscript || (() => {}),
    ws.__deepgramOnError,
    true,
  ) as DeepgramStream;

  // Transfer managed state onto the replacement socket and update caller's reference.
  next.__deepgramManaged = true;
  next.__deepgramClosedByClient = false;
  next.__deepgramReconnectAttempt = 0;
  next.__deepgramSampleRate = ws.__deepgramSampleRate;
  next.__deepgramOnTranscript = ws.__deepgramOnTranscript;
  next.__deepgramOnError = ws.__deepgramOnError;
  next.__deepgramReplaceSocket = ws.__deepgramReplaceSocket;
  attachDeepgramHandlers(next);
  startDeepgramKeepAlive(next);
  ws.__deepgramManaged = false;
  ws.__deepgramReplaceSocket?.(next);
  console.log('[Deepgram] Reconnected');
}

async function openDeepgramSocket(
  sampleRate: number,
  onTranscript: (event: DeepgramTranscriptEvent) => void,
  onError?: (err: any) => void,
  isReconnect = false,
  apiKey?: string,
): Promise<WebSocket> {
  const DEEPGRAM_API_KEY = apiKey ?? (await getKeys(true)).deepgram; // force fresh read so newly entered keys are picked up immediately

  // Read STT config from global store (consistent with LLM provider logic)
  const { settings } = useAppStore.getState();
  const sttProvider = (settings?.sttProvider as string) || 'deepgram';
  const sttModel = (settings?.sttModel as string) || 'nova-3';
  const sttLanguage = (settings?.sttLanguage as string) || 'zh-CN';

  if (!DEEPGRAM_API_KEY) {
    throw new Error('No Deepgram API key is configured. Add it in Settings before starting capture.');
  }

  // Use the actual mic sample rate reported by backend (fixes STT quality).
  // Deepgram accepts 16000, 44100, 48000 etc. as long as audio matches.
  // Model comes from settings (user-configurable in Settings page).
  const model = sttProvider === 'deepgram' ? sttModel : 'nova-3';

  // Browser/WebView clients authenticate with Deepgram's token WebSocket subprotocol.
  const language = `&language=${encodeURIComponent(sttLanguage)}`;
  const endpointing = sttLanguage === 'multi' ? 100 : 300;
  const wsUrl = `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=${sampleRate}&channels=1&model=${encodeURIComponent(model)}&interim_results=true&smart_format=true&punctuate=true&utterance_end_ms=1000&vad_events=true${language}&endpointing=${endpointing}`;

  const ws = new WebSocket(wsUrl, ['token', DEEPGRAM_API_KEY]) as DeepgramStream;
  ws.binaryType = 'arraybuffer';
  ws.__deepgramSampleRate = sampleRate;
  ws.__deepgramOnTranscript = onTranscript;
  ws.__deepgramOnError = onError;
  attachDeepgramHandlers(ws);

  return new Promise<WebSocket>((resolve, reject) => {
    let opened = false;
    const timeout = globalThis.setTimeout(() => {
      ws.close();
      reject(new Error(isReconnect ? 'Deepgram reconnect timed out' : 'Deepgram connection timed out'));
    }, DEEPGRAM_CONNECT_TIMEOUT_MS);
    (timeout as { unref?: () => void }).unref?.();

    const previousOnOpen = ws.onopen;
    const previousOnError = ws.onerror;
    const previousOnClose = ws.onclose;

    ws.onopen = (event) => {
      opened = true;
      globalThis.clearTimeout(timeout);
      console.log(isReconnect ? '[Deepgram] Reconnected socket open' : '[Deepgram] Connected');
      startDeepgramKeepAlive(ws);
      previousOnOpen?.call(ws, event);
      resolve(ws);
    };

    ws.onerror = (event) => {
      previousOnError?.call(ws, event);
      if (!opened) {
        globalThis.clearTimeout(timeout);
        reject(new Error(isReconnect ? 'Deepgram reconnect failed' : 'Deepgram connection failed'));
      }
    };

    ws.onclose = (event) => {
      globalThis.clearTimeout(timeout);
      previousOnClose?.call(ws, event);
      if (!opened) reject(new Error(isReconnect ? 'Deepgram reconnect closed before it was ready' : 'Deepgram connection closed before it was ready'));
    };
  });
}

export async function startDeepgramStream(
  onTranscript: (event: DeepgramTranscriptEvent) => void,
  onError?: (err: any) => void,
  sampleRate: number = 16000,
  onSocketChange?: (ws: WebSocket) => void,
): Promise<WebSocket> {
  const ws = await openDeepgramSocket(sampleRate, onTranscript, onError, false) as DeepgramStream;
  ws.__deepgramManaged = true;
  ws.__deepgramClosedByClient = false;
  ws.__deepgramReconnectAttempt = 0;
  ws.__deepgramReplaceSocket = (next) => {
    onSocketChange?.(next);
  };
  onSocketChange?.(ws);
  return ws;
}

export async function testDeepgramConnection(apiKey: string): Promise<void> {
  const ws = await openDeepgramSocket(16_000, () => {}, undefined, false, apiKey);
  closeDeepgramStream(ws);
}

/**
 * Send a Float32 chunk (from Rust cpal) to an active Deepgram WebSocket.
 * Automatically converts to Int16 PCM and sends as binary.
 */
export function sendAudioChunk(ws: WebSocket | null, float32Chunk: Float32Array) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount >= MAX_DEEPGRAM_BUFFERED_BYTES) return;

  const pcm16 = float32ToInt16(float32Chunk);
  ws.send(pcm16.buffer);
}

export async function generateStructuredJson<T>(
  system: string,
  prompt: string,
  signal?: AbortSignal,
  options: { allowProviderFallback?: boolean; maxOutputTokens?: number } = {},
): Promise<T> {
  const { provider, model, apiKey } = await resolveConfiguredProvider(options.allowProviderFallback !== false);
  if (!apiKey) throw new Error('No LLM API key is configured. Add a provider key in Settings and retry.');
  const maxOutputTokens = options.maxOutputTokens ?? 2_400;

  let response: Response;
  if (provider === 'anthropic') {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: maxOutputTokens, system, messages: [{ role: 'user', content: prompt }] }),
    });
  } else if (provider === 'gemini') {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens, responseMimeType: 'application/json' } }),
    });
  } else {
    const url = provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    response = await fetch(url, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.3, ...(provider === 'openai' ? { max_completion_tokens: maxOutputTokens, response_format: { type: 'json_object' } } : { max_tokens: maxOutputTokens, response_format: { type: 'json_object' } }) }),
    });
  }

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `${provider} error ${response.status}`);
  const text = provider === 'anthropic'
    ? (data?.content || []).filter((block: any) => block?.type === 'text').map((block: any) => block.text).join('\n')
    : provider === 'gemini'
      ? data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('')
      : data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('The LLM returned an empty response.');
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error('The LLM returned invalid JSON. Please retry.');
  }
}

/** Gracefully close a Deepgram stream */
export function closeDeepgramStream(ws: WebSocket | null) {
  if (!ws) return;
  const managed = ws as DeepgramStream;
  managed.__deepgramClosedByClient = true;
  managed.__deepgramManaged = false;
  clearDeepgramTimers(managed);
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    // Send a final empty message is not required; just close
    ws.close();
  }
}
