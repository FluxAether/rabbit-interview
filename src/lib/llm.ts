// Real LLM + STT integration hooks using SQLite-backed encrypted key storage
import { loadApiKeys, getLlmApiKey } from './keyStore';
import { useAppStore } from '../stores/useAppStore';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { GEMINI_LIVE_TRANSCRIBE_MODEL, GEMINI_LIVE_TRANSLATE_MODEL } from './settingsStore';

let cachedKeys: Awaited<ReturnType<typeof loadApiKeys>> | null = null;

const INTERVIEW_ANSWER_SYSTEM = 'You are an interview copilot. Answer every interviewer question in the prompt. If the interviewer asked more than one question, answer each one in order and do not skip any. Prefer Candidate said over Suggested answer; do not treat Suggested answer or Suggested but not used as something the candidate already said. Respond in the same language as the question. Be accurate, specific, concise, and professional. Give a complete answer of roughly 5 to 8 sentences, use plain paragraphs without Markdown headings, and always finish the final sentence.';
const FOLLOW_UP_SYSTEM = 'You are an interview copilot handling a user follow-up. Answer the request directly using recent interview turns and provided context. Prefer Candidate said over Suggested answer. Do not treat the request itself as a new interviewer question. Use plain paragraphs without Markdown headings and always finish the final sentence.';

type ByokLlmProvider = 'groq' | 'openai' | 'anthropic' | 'gemini';
type LlmProvider = ByokLlmProvider | 'hosted';
export type HostedLlmProvider = 'gemini' | 'openai' | 'anthropic' | 'groq';
export type HostedSttProvider = 'volcengine' | 'deepgram' | 'gemini_live';

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
 *   "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"
 */
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const SUPPORTED_GEMINI_MODELS = new Set(['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash']);

function resolveProviderAndModel(aiModel: string): { provider: ByokLlmProvider; model: string } {
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
  upstreamProvider?: HostedLlmProvider;
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
  provider: ByokLlmProvider;
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
  upstreamProvider?: HostedLlmProvider;
  model?: string;
}

function hostedLlmProvider(value: unknown): HostedLlmProvider | undefined {
  return value === 'gemini' || value === 'openai' || value === 'anthropic' || value === 'groq'
    ? value
    : undefined;
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
  let upstreamProvider: HostedLlmProvider | undefined;
  let resolvedModel = model;

  const processEvent = (event: string) => {
    const data = parseSseEventData(event);
    if (!data || data === '[DONE]') return;
    const parsed = parsePayload(JSON.parse(data));
    if (parsed.finishReason) finishReason = parsed.finishReason;
    if (parsed.upstreamProvider) upstreamProvider = parsed.upstreamProvider;
    if (parsed.model) resolvedModel = parsed.model;
    if (!parsed.delta) return;
    accumulated += parsed.delta;
    handlers.onDelta(parsed.delta, accumulated);
  };

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (normalized.name === 'AbortError') throw normalized;
      streamError = normalized;
      break;
    }
    const { value, done } = chunk;
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

  const result: LlmStreamResult = {
    text: accumulated,
    status: streamError ? 'incomplete' : classifyStreamStatus(finishReason),
    finishReason: streamError ? 'connection_lost' : finishReason,
    provider,
    model: resolvedModel,
    ...(upstreamProvider ? { upstreamProvider } : {}),
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
    if (useAppStore.getState().settings?.aiAccessMode === 'hosted') {
      return generateHostedSuggestionsStream(question, context, handlers, signal, requestType, options);
    }
    const { provider, model, apiKey } = await resolveConfiguredProvider();
    const isFollowUp = requestType === 'follow-up';
    const basePrompt = isFollowUp
      ? `Respond in the same language as the user. Apply the request to recent interview turns when relevant.\nUser follow-up: ${question}\nRelevant resume, job and recent interview turns: ${context || 'none'}`
      : `Answer every interviewer question in the same language, using the relevant resume, job and recent interview turns. If there are multiple questions, answer each one in order and do not skip any.\nInterviewer question: ${question}\nRelevant resume, job and recent interview turns: ${context || 'none'}`;
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

async function generateHostedSuggestionsStream(
  question: string,
  context: string,
  handlers: SuggestionStreamHandlers,
  signal?: AbortSignal,
  requestType: SuggestionRequestType = 'interviewer-question',
  options: SuggestionStreamOptions = {},
): Promise<LlmStreamResult> {
  const requestId = crypto.randomUUID();
  const { hostedFetch } = await import('./hostedAuth');
  const cancel = () => {
    void hostedFetch(`/v1/llm/answers/${requestId}`, { method: 'DELETE' }).catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await hostedFetch('/v1/llm/answers', {
      method: 'POST',
      signal,
      headers: {
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json',
        'Idempotency-Key': requestId,
      },
      body: JSON.stringify({
        request_id: requestId,
        request_type: requestType,
        question,
        context: { combined: context },
        continuation_text: options.continuationText,
      }),
    });
    return consumeSse(
      response,
      (payload) => {
        if (payload?.code) throw new Error(payload.code);
        return {
          delta: typeof payload?.delta === 'string' ? payload.delta : null,
          finishReason: payload?.finish_reason || null,
          upstreamProvider: hostedLlmProvider(payload?.provider),
          model: typeof payload?.model === 'string' && payload.model.length <= 128
            ? payload.model
            : undefined,
        };
      },
      handlers,
      'hosted',
      'gemini-3.7-flash',
    );
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

// ==================== STT (Speech-to-Text) Streaming ====================
const MAX_DEEPGRAM_BUFFERED_BYTES = 512 * 1024;
const DEEPGRAM_CONNECT_TIMEOUT_MS = 10_000;
const DEEPGRAM_KEEPALIVE_MS = 8_000;
const DEEPGRAM_RECONNECT_BASE_MS = 1_000;
const DEEPGRAM_RECONNECT_MAX_MS = 15_000;
const GEMINI_UTTERANCE_END_MS = 1_500;
const GEMINI_LIVE_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
// The Deepgram-named exports are kept as the shared STT facade for backward compatibility.

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

export interface DeepgramStreamOptions {
  language?: string;
  endpointingMs?: number;
  utteranceEndMs?: number;
  source?: string;
}

export interface DeepgramStream extends WebSocket {
  __sttProvider?: 'deepgram' | 'gemini' | 'apple' | 'hosted';
  __hostedProvider?: HostedSttProvider;
  __hostedModel?: string;
  __deepgramManaged?: boolean;
  __deepgramClosedByClient?: boolean;
  __deepgramKeepAliveTimer?: ReturnType<typeof globalThis.setInterval> | null;
  __deepgramReconnectTimer?: ReturnType<typeof globalThis.setTimeout> | null;
  __deepgramReconnectAttempt?: number;
  __deepgramSampleRate?: number;
  __deepgramOptions?: DeepgramStreamOptions;
  __deepgramOnTranscript?: (event: DeepgramTranscriptEvent) => void;
  __deepgramOnError?: (err: any) => void;
  __deepgramReplaceSocket?: (next: WebSocket) => void;
  __geminiSetupComplete?: boolean;
  __geminiSetupResolve?: () => void;
  __geminiSetupReject?: (error: Error) => void;
  __geminiModel?: string;
  __geminiInputLanguage?: string;
  __geminiAppLanguage?: string;
  __geminiFinalSeen?: boolean;
  __geminiUtteranceEnded?: boolean;
  __geminiUtteranceEndTimer?: ReturnType<typeof globalThis.setTimeout> | null;
  __geminiRotating?: boolean;
  __hostedUnregister?: (() => void) | null;
  __hostedSessionEnded?: boolean;
}

function clearGeminiUtteranceEndTimer(ws: DeepgramStream) {
  if (ws.__geminiUtteranceEndTimer == null) return;
  globalThis.clearTimeout(ws.__geminiUtteranceEndTimer);
  ws.__geminiUtteranceEndTimer = null;
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
  clearGeminiUtteranceEndTimer(ws);
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
      if (data.type === 'UtteranceEnd' && data.last_word_end === -1) return;
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
    undefined,
    ws.__deepgramOptions,
  ) as DeepgramStream;

  // Transfer managed state onto the replacement socket and update caller's reference.
  next.__deepgramManaged = true;
  next.__deepgramClosedByClient = false;
  next.__deepgramReconnectAttempt = 0;
  next.__deepgramSampleRate = ws.__deepgramSampleRate;
  next.__deepgramOptions = ws.__deepgramOptions;
  next.__deepgramOnTranscript = ws.__deepgramOnTranscript;
  next.__deepgramOnError = ws.__deepgramOnError;
  next.__deepgramReplaceSocket = ws.__deepgramReplaceSocket;
  attachDeepgramHandlers(next);
  startDeepgramKeepAlive(next);
  ws.__deepgramManaged = false;
  ws.__deepgramReplaceSocket?.(next);
  console.log('[Deepgram] Reconnected');
}

function geminiTargetLanguage(appLanguage: string): 'zh-Hans' | 'zh-Hant' | 'en' {
  if (appLanguage === 'zh-CN') return 'zh-Hans';
  if (appLanguage === 'zh-TW') return 'zh-Hant';
  return 'en';
}

function geminiSetup(model: string, inputLanguage: string, appLanguage: string) {
  const generationConfig = model === GEMINI_LIVE_TRANSCRIBE_MODEL
    ? { responseModalities: ['TEXT'] }
    : {
        responseModalities: ['AUDIO'],
        translationConfig: {
          targetLanguageCode: geminiTargetLanguage(appLanguage),
          echoTargetLanguage: true,
        },
      };
  const setup: Record<string, unknown> = {
    model: `models/${model}`,
    generationConfig,
    inputAudioTranscription: inputLanguage === 'multi'
      ? {}
      : { languageCodes: [inputLanguage] },
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        prefixPaddingMs: 20,
        endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
        silenceDurationMs: GEMINI_UTTERANCE_END_MS,
      },
    },
  };
  return { setup };
}

function emitGeminiUtteranceEnd(ws: DeepgramStream) {
  if (!ws.__geminiFinalSeen || ws.__geminiUtteranceEnded) return;
  clearGeminiUtteranceEndTimer(ws);
  ws.__geminiUtteranceEnded = true;
  ws.__deepgramOnTranscript?.({ text: '', isFinal: true, boundary: 'utterance-end' });
}

function scheduleGeminiUtteranceEnd(ws: DeepgramStream) {
  clearGeminiUtteranceEndTimer(ws);
  const timer = globalThis.setTimeout(
    () => emitGeminiUtteranceEnd(ws),
    ws.__deepgramOptions?.utteranceEndMs ?? GEMINI_UTTERANCE_END_MS,
  );
  (timer as { unref?: () => void }).unref?.();
  ws.__geminiUtteranceEndTimer = timer;
}

function attachGeminiHandlers(ws: DeepgramStream) {
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    try {
      ws.send(JSON.stringify(geminiSetup(
        ws.__geminiModel || GEMINI_LIVE_TRANSLATE_MODEL,
        ws.__geminiInputLanguage || 'multi',
        ws.__geminiAppLanguage || 'en-US',
      )));
    } catch (error) {
      ws.__geminiSetupReject?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  ws.onmessage = (event) => {
    try {
      const payload = typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data);
      const data = JSON.parse(payload);
      if (data.error) {
        const error = new Error(data.error.message || 'Gemini Live connection failed');
        if (!ws.__geminiSetupComplete) ws.__geminiSetupReject?.(error);
        else ws.__deepgramOnError?.(error);
        return;
      }
      if ('setupComplete' in data) {
        ws.__geminiSetupComplete = true;
        ws.__geminiSetupResolve?.();
        return;
      }

      const content = data.serverContent || data;
      const interim = content.interimInputTranscription?.text?.trim();
      const final = content.inputTranscription?.text?.trim();
      if ((interim || final) && ws.__geminiUtteranceEnded) {
        ws.__geminiFinalSeen = false;
        ws.__geminiUtteranceEnded = false;
      }
      if (interim) {
        ws.__deepgramOnTranscript?.({ text: interim, isFinal: false, boundary: 'interim' });
      }

      if (final) {
        ws.__geminiFinalSeen = true;
        ws.__deepgramOnTranscript?.({ text: final, isFinal: true, boundary: 'final' });
        // Gemini sends transcription independently of turnComplete with no ordering guarantee.
        scheduleGeminiUtteranceEnd(ws);
      }

      if (data.goAway && !ws.__geminiRotating) {
        void rotateGeminiStream(ws);
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (!ws.__geminiSetupComplete) ws.__geminiSetupReject?.(normalized);
      else ws.__deepgramOnError?.(normalized);
    }
  };

  ws.onerror = () => {
    console.error('[Gemini Live] WebSocket error');
    if (!ws.__geminiSetupComplete) {
      ws.__geminiSetupReject?.(new Error('Gemini Live connection failed'));
    }
  };

  ws.onclose = () => {
    clearDeepgramTimers(ws);
    console.log('[Gemini Live] Connection closed');
    if (!ws.__geminiSetupComplete) {
      ws.__geminiSetupReject?.(new Error('Gemini Live connection closed before setup completed'));
    }
    if (!ws.__deepgramManaged || ws.__deepgramClosedByClient || ws.__geminiRotating) return;
    scheduleGeminiReconnect(ws);
  };
}

function scheduleGeminiReconnect(ws: DeepgramStream) {
  if (ws.__deepgramClosedByClient || !ws.__deepgramManaged) return;
  if (ws.__deepgramReconnectTimer != null) return;

  const attempt = (ws.__deepgramReconnectAttempt ?? 0) + 1;
  ws.__deepgramReconnectAttempt = attempt;
  const delay = Math.min(
    DEEPGRAM_RECONNECT_MAX_MS,
    DEEPGRAM_RECONNECT_BASE_MS * (2 ** Math.min(attempt - 1, 4)),
  );
  console.warn(`[Gemini Live] Reconnecting in ${delay}ms (attempt ${attempt})`);

  const timer = globalThis.setTimeout(() => {
    ws.__deepgramReconnectTimer = null;
    void reconnectGeminiStream(ws).catch((error) => {
      console.error('[Gemini Live] Reconnect failed', error);
      scheduleGeminiReconnect(ws);
    });
  }, delay);
  (timer as { unref?: () => void }).unref?.();
  ws.__deepgramReconnectTimer = timer;
}

function manageGeminiReplacement(previous: DeepgramStream, next: DeepgramStream) {
  const hasPendingUtterance = Boolean(previous.__geminiFinalSeen && !previous.__geminiUtteranceEnded);
  next.__deepgramManaged = true;
  next.__deepgramClosedByClient = false;
  next.__deepgramReconnectAttempt = 0;
  next.__deepgramReplaceSocket = previous.__deepgramReplaceSocket;
  previous.__deepgramManaged = false;
  clearDeepgramTimers(previous);
  if (hasPendingUtterance) {
    next.__geminiFinalSeen = true;
    scheduleGeminiUtteranceEnd(next);
  }
  previous.__deepgramReplaceSocket?.(next);
}

async function reconnectGeminiStream(ws: DeepgramStream): Promise<void> {
  if (ws.__deepgramClosedByClient || !ws.__deepgramManaged) return;
  const next = await openGeminiLiveSocket(
    ws.__deepgramOnTranscript || (() => {}),
    ws.__deepgramOnError,
    true,
    undefined,
    ws.__deepgramOptions,
    ws.__geminiInputLanguage,
    ws.__geminiAppLanguage,
    ws.__geminiModel,
  ) as DeepgramStream;
  if (ws.__deepgramClosedByClient || !ws.__deepgramManaged) {
    closeDeepgramStream(next);
    return;
  }
  manageGeminiReplacement(ws, next);
  console.log('[Gemini Live] Reconnected');
}

async function rotateGeminiStream(ws: DeepgramStream): Promise<void> {
  if (ws.__deepgramClosedByClient || !ws.__deepgramManaged || ws.__geminiRotating) return;
  ws.__geminiRotating = true;
  try {
    const next = await openGeminiLiveSocket(
      ws.__deepgramOnTranscript || (() => {}),
      ws.__deepgramOnError,
      true,
      undefined,
      ws.__deepgramOptions,
      ws.__geminiInputLanguage,
      ws.__geminiAppLanguage,
      ws.__geminiModel,
    ) as DeepgramStream;
    if (ws.__deepgramClosedByClient || !ws.__deepgramManaged) {
      closeDeepgramStream(next);
      return;
    }
    manageGeminiReplacement(ws, next);
    ws.close();
    console.log('[Gemini Live] Rotated connection after goAway');
  } catch (error) {
    ws.__deepgramOnError?.(error);
    if (ws.readyState === WebSocket.CLOSED) scheduleGeminiReconnect(ws);
  } finally {
    ws.__geminiRotating = false;
  }
}

async function openGeminiLiveSocket(
  onTranscript: (event: DeepgramTranscriptEvent) => void,
  onError?: (err: any) => void,
  isReconnect = false,
  apiKey?: string,
  options: DeepgramStreamOptions = {},
  inputLanguage?: string,
  appLanguage?: string,
  sttModel?: string,
): Promise<WebSocket> {
  const key = apiKey ?? (await getKeys(true)).gemini;
  if (!key) {
    throw new Error('No Gemini API key is configured. Add it in Settings before starting capture.');
  }

  const { settings } = useAppStore.getState();
  const configuredModel = sttModel || (settings?.sttModel as string);
  const ws = new WebSocket(`${GEMINI_LIVE_ENDPOINT}?key=${encodeURIComponent(key)}`) as DeepgramStream;
  ws.__sttProvider = 'gemini';
  ws.__deepgramOptions = { ...options };
  ws.__deepgramOnTranscript = onTranscript;
  ws.__deepgramOnError = onError;
  ws.__geminiModel = configuredModel === GEMINI_LIVE_TRANSCRIBE_MODEL
    ? GEMINI_LIVE_TRANSCRIBE_MODEL
    : GEMINI_LIVE_TRANSLATE_MODEL;
  ws.__geminiInputLanguage = inputLanguage || options.language || (settings?.sttLanguage as string) || 'multi';
  ws.__geminiAppLanguage = appLanguage || (settings?.language as string) || 'en-US';
  ws.__geminiSetupComplete = false;
  ws.__geminiFinalSeen = false;
  ws.__geminiUtteranceEnded = false;
  attachGeminiHandlers(ws);

  return new Promise<WebSocket>((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error(isReconnect ? 'Gemini Live reconnect timed out' : 'Gemini Live connection timed out'));
    }, DEEPGRAM_CONNECT_TIMEOUT_MS);
    (timeout as { unref?: () => void }).unref?.();

    ws.__geminiSetupResolve = () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      console.log(isReconnect ? '[Gemini Live] Reconnected socket ready' : '[Gemini Live] Connected');
      resolve(ws);
    };
    ws.__geminiSetupReject = (error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      reject(error);
    };
  });
}

async function openDeepgramSocket(
  sampleRate: number,
  onTranscript: (event: DeepgramTranscriptEvent) => void,
  onError?: (err: any) => void,
  isReconnect = false,
  apiKey?: string,
  options: DeepgramStreamOptions = {},
): Promise<WebSocket> {
  const DEEPGRAM_API_KEY = apiKey ?? (await getKeys(true)).deepgram; // force fresh read so newly entered keys are picked up immediately

  // Read STT config from global store (consistent with LLM provider logic)
  const { settings } = useAppStore.getState();
  const sttProvider = (settings?.sttProvider as string) || 'deepgram';
  const sttModel = (settings?.sttModel as string) || 'nova-3';
  const sttLanguage = options.language || (settings?.sttLanguage as string) || 'zh-CN';

  if (!DEEPGRAM_API_KEY) {
    throw new Error('No Deepgram API key is configured. Add it in Settings before starting capture.');
  }

  // Use the actual mic sample rate reported by backend (fixes STT quality).
  // Deepgram accepts 16000, 44100, 48000 etc. as long as audio matches.
  // Model comes from settings (user-configurable in Settings page).
  const model = sttProvider === 'deepgram' ? sttModel : 'nova-3';

  // Browser/WebView clients authenticate with Deepgram's token WebSocket subprotocol.
  const language = `&language=${encodeURIComponent(sttLanguage)}`;
  const endpointing = options.endpointingMs ?? (sttLanguage === 'multi' ? 100 : 300);
  const utteranceEndMs = options.utteranceEndMs ?? 1000;
  const wsUrl = `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=${sampleRate}&channels=1&model=${encodeURIComponent(model)}&interim_results=true&smart_format=true&punctuate=true&utterance_end_ms=${utteranceEndMs}&vad_events=true${language}&endpointing=${endpointing}`;

  const ws = new WebSocket(wsUrl, ['token', DEEPGRAM_API_KEY]) as DeepgramStream;
  ws.binaryType = 'arraybuffer';
  ws.__sttProvider = 'deepgram';
  ws.__deepgramSampleRate = sampleRate;
  ws.__deepgramOptions = { ...options };
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


interface AppleSttStream extends DeepgramStream {
  __appleSources?: string[];
  __appleUnlisten?: Promise<UnlistenFn> | null;
  __appleClosed?: boolean;
}

const appleSttStreams: AppleSttStream[] = [];

class AppleSttSocket {
  // Match the DOM WebSocket enum so sendAudioChunk sees the socket as open.
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = (typeof WebSocket === 'undefined' ? AppleSttSocket.OPEN : WebSocket.OPEN);
  bufferedAmount = 0;
  binaryType = 'arraybuffer';
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send(_data?: unknown) {}
  close() {
    this.readyState = AppleSttSocket.CLOSED;
    this.onclose?.({ code: 1000, wasClean: true } as CloseEvent);
  }
}

async function openAppleSttSocket(
  onTranscript: (event: DeepgramTranscriptEvent) => void,
  onError?: (err: any) => void,
  options: DeepgramStreamOptions = {},
): Promise<WebSocket> {
  const settings = useAppStore.getState().settings;
  const language = options.language || (settings?.sttLanguage as string) || 'zh-CN';
  if (language === 'multi') {
    throw new Error('Apple on-device STT does not support multilingual auto-detect');
  }

  const ws = new AppleSttSocket() as unknown as AppleSttStream;
  ws.__sttProvider = 'apple';
  ws.__deepgramOptions = { ...options };
  ws.__deepgramOnTranscript = onTranscript;
  ws.__deepgramOnError = onError;
  ws.__appleClosed = false;
  ws.__appleSources = options.source ? [options.source] : [];
  ws.__appleUnlisten = listen<{ source: string; text: string; is_final: boolean; boundary: string }>('stt-transcript', (event) => {
    if (ws.__appleClosed) return;
    const sources = ws.__appleSources || [];
    if (!sources.includes(event.payload.source)) return;
    const boundary = (event.payload.boundary || (event.payload.is_final ? 'final' : 'interim')) as TranscriptBoundary;
    ws.__deepgramOnTranscript?.({
      text: event.payload.text || '',
      isFinal: Boolean(event.payload.is_final) || boundary === 'final' || boundary === 'utterance-end',
      boundary,
    });
  }).catch((error) => {
    ws.__deepgramOnError?.(error);
    return () => {};
  });

  appleSttStreams.push(ws);
  return ws;
}

export async function ensureAppleSttSources(sources: string[], language?: string): Promise<void> {
  const settings = useAppStore.getState().settings;
  const resolvedLanguage = language || (settings?.sttLanguage as string) || 'zh-CN';
  await invoke('start_apple_stt', { sources, language: resolvedLanguage });
}

export async function testAppleSttConnection(language = 'zh-CN'): Promise<void> {
  await invoke('test_apple_stt', { language });
}

let hostedInterviewId: string | null = null;
let activeHostedStreams = 0;

async function openHostedSttSocket(
  sampleRate: number,
  onTranscript: (event: DeepgramTranscriptEvent) => void,
  onError?: (err: any) => void,
  options: DeepgramStreamOptions = {},
): Promise<WebSocket> {
  if (sampleRate !== 16_000) {
    throw new Error('Hosted STT v1 requires 16 kHz audio. Restart capture with the standard audio pipeline.');
  }
  const source = options.source === 'system' ? 'system' : 'microphone';
  const settings = useAppStore.getState().settings;
  const language = options.language || (settings?.sttLanguage as string) || 'zh-CN';
  const interviewId = hostedInterviewId || crypto.randomUUID();
  hostedInterviewId = interviewId;
  const clientRequestId = crypto.randomUUID();
  const { hostedFetch, registerHostedConnection } = await import('./hostedAuth');
  const response = await hostedFetch('/v1/stt/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': clientRequestId },
    body: JSON.stringify({
      client_request_id: clientRequestId,
      interview_id: interviewId,
      source,
      language,
      audio: { encoding: 'pcm_s16le', sample_rate: 16_000, channels: 1 },
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; code?: string } | null;
    throw new Error(body?.message || body?.code || `Hosted STT failed with ${response.status}`);
  }
  const session = await response.json() as { ws_url: string; ws_ticket: string };
  const url = new URL(session.ws_url);
  url.searchParams.set('ticket', session.ws_ticket);
  const ws = new WebSocket(url) as DeepgramStream;
  ws.binaryType = 'arraybuffer';
  ws.__sttProvider = 'hosted';
  ws.__deepgramOptions = { ...options };
  ws.__deepgramOnTranscript = onTranscript;
  ws.__deepgramOnError = onError;
  ws.__hostedSessionEnded = false;
  activeHostedStreams += 1;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    ws.__hostedUnregister?.();
    ws.__hostedUnregister = null;
    activeHostedStreams = Math.max(0, activeHostedStreams - 1);
    if (activeHostedStreams === 0) hostedInterviewId = null;
  };
  ws.__hostedUnregister = registerHostedConnection(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stt.stop', reason: 'sign_out' }));
    ws.close();
  });

  return new Promise<WebSocket>((resolve, reject) => {
    let ready = false;
    const timer = globalThis.setTimeout(() => {
      cleanup();
      ws.close();
      reject(new Error('Hosted STT connection timed out'));
    }, DEEPGRAM_CONNECT_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (applyHostedSttReady(ws, payload)) {
          if (!ready) {
            ready = true;
            globalThis.clearTimeout(timer);
            resolve(ws);
          }
          return;
        }
        if (payload.type === 'transcript') {
          const boundary = ['interim', 'final', 'speech-final', 'utterance-end'].includes(payload.boundary)
            ? payload.boundary as TranscriptBoundary
            : 'interim';
          onTranscript({
            text: String(payload.text || ''),
            isFinal: boundary !== 'interim',
            boundary,
          });
        } else if (payload.type === 'quota.warning') {
          onError?.(new Error(`Hosted STT quota is low (${Number(payload.remaining_ms) || 0} ms remaining).`));
        } else if (payload.type === 'session.ended') {
          ws.__hostedSessionEnded = true;
          ws.close();
        }
      } catch (error) {
        onError?.(error);
      }
    };
    ws.onerror = (event) => {
      onError?.(event);
      if (!ready) {
        globalThis.clearTimeout(timer);
        cleanup();
        reject(new Error('Hosted STT connection failed'));
      }
    };
    ws.onclose = () => {
      globalThis.clearTimeout(timer);
      cleanup();
      if (!ready) reject(new Error('Hosted STT closed before it was ready'));
    };
  });
}

function applyHostedSttReady(ws: DeepgramStream, payload: any): boolean {
  if (payload?.type !== 'stt.ready') return false;
  if (payload.provider === 'volcengine' || payload.provider === 'deepgram' || payload.provider === 'gemini_live') {
    ws.__hostedProvider = payload.provider;
  }
  if (typeof payload.model === 'string' && payload.model.length <= 128) {
    ws.__hostedModel = payload.model;
  }
  return true;
}

export async function startDeepgramStream(
  onTranscript: (event: DeepgramTranscriptEvent) => void,
  onError?: (err: any) => void,
  sampleRate: number = 16000,
  onSocketChange?: (ws: WebSocket) => void,
  options: DeepgramStreamOptions = {},
): Promise<WebSocket> {
  const configured = useAppStore.getState().settings?.sttProvider;
  const provider = configured === 'hosted' ? 'hosted' : configured === 'gemini' ? 'gemini' : configured === 'apple' ? 'apple' : 'deepgram';
  const ws = await (provider === 'hosted'
    ? openHostedSttSocket(sampleRate, onTranscript, onError, options)
    : provider === 'gemini'
      ? openGeminiLiveSocket(onTranscript, onError, false, undefined, options)
      : provider === 'apple'
        ? openAppleSttSocket(onTranscript, onError, options)
        : openDeepgramSocket(sampleRate, onTranscript, onError, false, undefined, options)) as DeepgramStream;
  ws.__deepgramManaged = provider !== 'hosted';
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

export async function testGeminiLiveConnection(
  apiKey: string,
  inputLanguage = 'multi',
  appLanguage = 'en-US',
): Promise<void> {
  const ws = await openGeminiLiveSocket(
    () => {},
    undefined,
    false,
    apiKey,
    { language: inputLanguage },
    inputLanguage,
    appLanguage,
  );
  closeDeepgramStream(ws);
}

function pcm16ToBase64(pcm16: Int16Array): string {
  let binary = '';
  for (const byte of new Uint8Array(pcm16.buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Send a Float32 chunk (from Rust cpal) to an active Deepgram WebSocket.
 * Automatically converts to Int16 PCM and sends as binary.
 */
export function sendAudioChunk(ws: WebSocket | null, float32Chunk: Float32Array) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const managed = ws as DeepgramStream;
  if (managed.__sttProvider === 'apple') return;
  if (ws.bufferedAmount >= MAX_DEEPGRAM_BUFFERED_BYTES) return;

  const pcm16 = float32ToInt16(float32Chunk);
  if (managed.__sttProvider === 'gemini') {
    if (!managed.__geminiSetupComplete) return;
    ws.send(JSON.stringify({
      realtimeInput: {
        audio: {
          data: pcm16ToBase64(pcm16),
          mimeType: 'audio/pcm;rate=16000',
        },
      },
    }));
    return;
  }
  ws.send(pcm16.buffer);
}

export async function generateStructuredJson<T>(
  system: string,
  prompt: string,
  signal?: AbortSignal,
  options: {
    allowProviderFallback?: boolean
    maxOutputTokens?: number
    thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
  } = {},
): Promise<T> {
  if (useAppStore.getState().settings?.aiAccessMode === 'hosted') {
    return generateHostedStructuredJson<T>(system, prompt, signal, options.maxOutputTokens ?? 2_400);
  }
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
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens,
      responseMimeType: 'application/json',
    };
    if (model.startsWith('gemini-3')) {
      generationConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel ?? 'medium' };
    } else {
      generationConfig.temperature = 0.3;
    }
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: prompt }] }], generationConfig }),
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
  const finishReason = provider === 'anthropic'
    ? data?.stop_reason
    : provider === 'gemini'
      ? data?.candidates?.[0]?.finishReason
      : data?.choices?.[0]?.finish_reason;
  if (['length', 'max_tokens', 'max-tokens'].includes(String(finishReason || '').toLowerCase())) {
    throw new Error('llm-output-truncated');
  }
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

async function generateHostedStructuredJson<T>(
  system: string,
  prompt: string,
  signal: AbortSignal | undefined,
  maxOutputTokens: number,
): Promise<T> {
  const requestId = crypto.randomUUID();
  const { hostedFetch } = await import('./hostedAuth');
  const cancel = () => {
    void hostedFetch(`/v1/llm/answers/${requestId}`, { method: 'DELETE' }).catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await hostedFetch('/v1/llm/answers', {
      method: 'POST',
      signal,
      headers: {
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json',
        'Idempotency-Key': requestId,
      },
      body: JSON.stringify({
        request_id: requestId,
        request_type: 'structured-json',
        system,
        prompt,
        response_format: 'json',
        max_output_tokens: maxOutputTokens,
      }),
    });
    const result = await consumeSse(
      response,
      (payload) => {
        if (payload?.code) throw new Error(payload.code);
        return {
          delta: typeof payload?.delta === 'string' ? payload.delta : null,
          finishReason: payload?.finish_reason || null,
        };
      },
      { onDelta: () => {} },
      'hosted',
      'gemini-3.7-flash',
    );
    if (result.status === 'max-tokens') throw new Error('llm-output-truncated');
    if (result.status !== 'complete') throw new Error('The hosted LLM response was incomplete. Please retry.');
    if (!result.text) throw new Error('The hosted LLM returned an empty response.');
    const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new Error('The hosted LLM returned invalid JSON. Please retry.');
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

/** Gracefully close an STT stream */
export function closeDeepgramStream(ws: WebSocket | null) {
  if (!ws) return;
  const managed = ws as DeepgramStream;
  managed.__deepgramClosedByClient = true;
  managed.__deepgramManaged = false;
  clearDeepgramTimers(managed);
  if (managed.__sttProvider === 'hosted') {
    if (ws.readyState === WebSocket.OPEN && !managed.__hostedSessionEnded) {
      ws.send(JSON.stringify({ type: 'stt.stop', reason: 'client_stop' }));
      globalThis.setTimeout(() => ws.close(), 250);
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    return;
  }
  if (managed.__sttProvider === 'apple') {
    const apple = managed as AppleSttStream;
    apple.__appleClosed = true;
    void apple.__appleUnlisten?.then((unlisten) => unlisten()).catch(() => {});
    apple.__appleUnlisten = null;
    apple.__appleSources = [];
    const remaining = appleSttStreams.filter((stream) => stream !== apple && !stream.__appleClosed);
    appleSttStreams.splice(0, appleSttStreams.length, ...remaining);
    if (remaining.length === 0) {
      void invoke('stop_apple_stt').catch(() => {});
    }
  }
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    // Send a final empty message is not required; just close
    ws.close();
  }
}
