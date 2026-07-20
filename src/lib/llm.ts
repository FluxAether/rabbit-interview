// Real LLM + STT integration hooks using secure tauri-plugin-store
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
 *   "gemini-3.5-flash" (only supported Gemini model)
 */
function resolveProviderAndModel(aiModel: string): { provider: LlmProvider; model: string } {
  const configured = aiModel || 'llama-3.1-8b-instant';
  const m = configured.toLowerCase();

  if (m.startsWith('gemini')) {
    // Only gemini-3.5-flash is supported for Gemini (latest)
    return { provider: 'gemini', model: 'gemini-3.5-flash' };
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

async function callGroq(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: INTERVIEW_ANSWER_SYSTEM },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: answerTokenBudget('groq', model),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Groq error ${res.status}`);
  }
  return data.choices?.[0]?.message?.content || '';
}

async function callOpenAI(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: INTERVIEW_ANSWER_SYSTEM },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: answerTokenBudget('openai', model),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenAI error ${res.status}`);
  }
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(prompt: string, _model: string, apiKey: string): Promise<string> {
  // Gemini 3.5 Flash is the only supported model (latest as of 2026).
  const modelId = 'gemini-3.5-flash';

  // Use v1 endpoint with the exact model name requested by user.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: INTERVIEW_ANSWER_SYSTEM }]
      },
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: answerTokenBudget('gemini', modelId),
      }
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini error ${res.status}`;
    throw new Error(msg);
  }

  // Gemini response shape: candidates[0].content.parts[0].text
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

async function callAnthropic(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: answerTokenBudget('anthropic', model),
      system: INTERVIEW_ANSWER_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Anthropic error ${res.status}`);
  }
  return (data?.content || [])
    .filter((block: any) => block?.type === 'text')
    .map((block: any) => block.text)
    .join('\n');
}

export async function generateSuggestions(question: string, transcriptSoFar?: string): Promise<string[]> {
  // Read current selected model from the global store (works from plain modules)
  const { settings } = useAppStore.getState();
  const aiModel: string = settings?.aiModel || 'groq-llama-3.1';

  let { provider, model } = resolveProviderAndModel(aiModel);
  let apiKey = await getLlmApiKey(provider);

  // Robustness: if the selected provider has no key, auto-select the first provider that does have a key.
  // This makes "configure Gemini + Deepgram, start using" work even if you didn't explicitly switch the active AI model.
  if (!apiKey) {
    const candidates: ('gemini' | 'groq' | 'openai' | 'anthropic')[] = ['gemini', 'groq', 'openai', 'anthropic'];
    for (const cand of candidates) {
      if (cand === provider) continue;
      const k = await getLlmApiKey(cand);
      if (k) {
        provider = cand;
        // Use a reasonable default model per provider when auto-falling back
        model = cand === 'gemini'
          ? 'gemini-3.5-flash'
          : cand === 'openai'
            ? 'gpt-5.6-luna'
            : cand === 'anthropic'
              ? 'claude-haiku-4-5'
              : 'llama-3.1-8b-instant';
        apiKey = k;
        console.log('[LLM] Auto-selected provider with key:', provider);
        break;
      }
    }
  }

  const userPrompt = `Answer the interviewer question directly in the same language, using the previous context when relevant.\nInterviewer question: ${question}\nPrevious context: ${transcriptSoFar || 'none'}`;

  if (!apiKey) {
    return ['No LLM API key is configured. Add a provider key in Settings and retry.'];
  }

  try {
    let text = '';
    if (provider === 'gemini') {
      text = await callGemini(userPrompt, model, apiKey);
    } else if (provider === 'openai') {
      text = await callOpenAI(userPrompt, model, apiKey);
    } else if (provider === 'anthropic') {
      text = await callAnthropic(userPrompt, model, apiKey);
    } else {
      // groq (default)
      text = await callGroq(userPrompt, model, apiKey);
    }

    return text
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 3)
      .slice(0, 6);
  } catch (e: any) {
    return [`Error calling ${provider}: ${e?.message || e}`];
  }
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

async function resolveConfiguredProvider(): Promise<{
  provider: LlmProvider;
  model: string;
  apiKey: string;
}> {
  const aiModel: string = useAppStore.getState().settings?.aiModel || 'groq-llama-3.1';
  let { provider, model } = resolveProviderAndModel(aiModel);
  let apiKey = await getLlmApiKey(provider);
  if (!apiKey) {
    const candidates: Array<'gemini' | 'groq' | 'openai' | 'anthropic'> = ['gemini', 'groq', 'openai', 'anthropic'];
    for (const candidate of candidates) {
      const candidateKey = await getLlmApiKey(candidate);
      if (!candidateKey) continue;
      provider = candidate;
      apiKey = candidateKey;
      model = candidate === 'gemini'
        ? 'gemini-3.5-flash'
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
 *
 * Usage in Copilot:
 *   const ws = await startDeepgramStream(({ text, isUtteranceFinal }) => { ... });
 *   // on each audio-chunk event:
 *   sendAudioChunk(ws, chunkFloat32Array);
 */
export interface DeepgramTranscriptEvent {
  text: string;
  isFinal: boolean;
  isUtteranceFinal: boolean;
}

export async function startDeepgramStream(
  onTranscript: (event: DeepgramTranscriptEvent) => void,
  onError?: (err: any) => void,
  sampleRate: number = 16000
): Promise<WebSocket> {
  const { deepgram: DEEPGRAM_API_KEY } = await getKeys(true); // force fresh read so newly entered keys are picked up immediately

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

  const ws = new WebSocket(wsUrl, ['token', DEEPGRAM_API_KEY]);
  ws.binaryType = 'arraybuffer';

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
      const isUtteranceFinal = Boolean(data.speech_final || data.type === 'UtteranceEnd');
      if (transcript || isUtteranceFinal) {
        onTranscript({
          text: transcript || '',
          isFinal: Boolean(data.is_final),
          isUtteranceFinal,
        });
      }
    } catch (e) {
      onError?.(e);
    }
  };

  return new Promise<WebSocket>((resolve, reject) => {
    let opened = false;
    const timeout = globalThis.setTimeout(() => {
      ws.close();
      reject(new Error('Deepgram connection timed out'));
    }, 10_000);

    ws.onopen = () => {
      opened = true;
      globalThis.clearTimeout(timeout);
      console.log('[Deepgram] Connected');
      resolve(ws);
    };

    ws.onerror = (event) => {
      console.error('[Deepgram] WS error', event);
      if (!opened) {
        globalThis.clearTimeout(timeout);
        reject(new Error('Deepgram connection failed'));
      } else {
        onError?.(event);
      }
    };

    ws.onclose = () => {
      globalThis.clearTimeout(timeout);
      console.log('[Deepgram] Connection closed');
      if (!opened) reject(new Error('Deepgram connection closed before it was ready'));
    };
  });
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

/** Gracefully close a Deepgram stream */
export function closeDeepgramStream(ws: WebSocket | null) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    // Send a final empty message is not required; just close
    ws.close();
  }
}

export async function generateNextQuestion(): Promise<string> {
  await new Promise(r => setTimeout(r, 120));
  return "Follow-up: How did you measure success in that situation?";
}
