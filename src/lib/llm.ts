// Real LLM + STT integration hooks using secure tauri-plugin-store
import { loadApiKeys, getLlmApiKey } from './keyStore';
import { useAppStore } from '../stores/useAppStore';

let cachedKeys: Awaited<ReturnType<typeof loadApiKeys>> | null = null;

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
function resolveProviderAndModel(aiModel: string): { provider: 'groq' | 'openai' | 'anthropic' | 'gemini'; model: string } {
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
        { role: 'system', content: 'You are an expert interview coach. Return 4-5 concise bullet points in STAR format for the given interviewer question. Be specific and professional.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 220,
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
        { role: 'system', content: 'You are an expert interview coach. Return 4-5 concise bullet points in STAR format for the given interviewer question. Be specific and professional.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 220,
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
        parts: [{ text: 'You are an expert interview coach. Return 4-5 concise bullet points in STAR format for the given interviewer question. Be specific and professional.' }]
      },
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 220,
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
      max_tokens: 220,
      system: 'You are an expert interview coach. Return 4-5 concise bullet points in STAR format for the given interviewer question. Be specific and professional.',
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

  const userPrompt = `Interviewer question: ${question}\nPrevious context: ${transcriptSoFar || 'none'}`;

  if (!apiKey) {
    // Fallback to smart mock (same behavior as before)
    await new Promise(r => setTimeout(r, 120));
    return [
      `Situation: Briefly set the context for "${question.slice(0, 40)}...".`,
      "Task: State your specific responsibility.",
      "Action: 2-3 concrete steps and trade-offs.",
      "Result: Quantify impact (users, %, time, revenue).",
      "Keep it under 90 seconds using STAR."
    ];
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

// ==================== STT (Speech-to-Text) Streaming ====================
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
 *   const ws = await startDeepgramStream((text, isFinal) => { ... });
 *   // on each audio-chunk event:
 *   sendAudioChunk(ws, chunkFloat32Array);
 */
export async function startDeepgramStream(
  onTranscript: (text: string, isFinal: boolean) => void,
  onError?: (err: any) => void,
  sampleRate: number = 16000
): Promise<WebSocket | null> {
  const { deepgram: DEEPGRAM_API_KEY } = await getKeys(true); // force fresh read so newly entered keys are picked up immediately

  // Read STT config from global store (consistent with LLM provider logic)
  const { settings } = useAppStore.getState();
  const sttProvider = (settings?.sttProvider as string) || 'deepgram';
  const sttModel = (settings?.sttModel as string) || 'nova-3';

  if (!DEEPGRAM_API_KEY) {
    console.warn('No Deepgram key — live transcription disabled');
    return null;
  }

  // Use the actual mic sample rate reported by backend (fixes STT quality).
  // Deepgram accepts 16000, 44100, 48000 etc. as long as audio matches.
  // Model comes from settings (user-configurable in Settings page).
  const model = sttProvider === 'deepgram' ? sttModel : 'nova-3';

  // Browser/WebView clients authenticate with Deepgram's token WebSocket subprotocol.
  const language = model === 'nova-3' ? '&language=multi&endpointing=100' : '';
  const wsUrl = `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=${sampleRate}&channels=1&model=${encodeURIComponent(model)}&interim_results=true&smart_format=true&punctuate=true${language}`;

  const ws = new WebSocket(wsUrl, ['token', DEEPGRAM_API_KEY]);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    console.log('[Deepgram] Connected');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
      if (transcript) {
        onTranscript(transcript, data.speech_final ?? !!data.is_final);
      }
    } catch (e) {
      onError?.(e);
    }
  };

  ws.onerror = (event) => {
    console.error('[Deepgram] WS error', event);
    onError?.(event);
  };

  ws.onclose = () => {
    console.log('[Deepgram] Connection closed');
  };

  return ws;
}

/**
 * Send a Float32 chunk (from Rust cpal) to an active Deepgram WebSocket.
 * Automatically converts to Int16 PCM and sends as binary.
 */
export function sendAudioChunk(ws: WebSocket | null, float32Chunk: Float32Array) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

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
