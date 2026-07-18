// Real LLM + STT integration hooks using secure tauri-plugin-store
import { loadApiKeys, getLlmApiKey } from './keyStore';
import { useAppStore } from '../stores/useAppStore';

let cachedKeys: Awaited<ReturnType<typeof loadApiKeys>> | null = null;

export function clearKeyCache() {
  cachedKeys = null;
}

async function getKeys() {
  if (!cachedKeys) {
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
 *   "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"
 */
function resolveProviderAndModel(aiModel: string): { provider: 'groq' | 'openai' | 'anthropic' | 'gemini'; model: string } {
  const m = (aiModel || 'groq-llama-3.1').toLowerCase();

  if (m.startsWith('gemini')) {
    // gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash etc.
    return { provider: 'gemini', model: aiModel };
  }
  if (m.includes('claude')) {
    return { provider: 'anthropic', model: aiModel };
  }
  if (m.includes('gpt') || m.startsWith('openai')) {
    return { provider: 'openai', model: aiModel.includes('gpt') ? aiModel : 'gpt-4o' };
  }
  // default + groq
  return { provider: 'groq', model: 'llama-3.1-8b-instant' };
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
      model: model.includes('gpt') ? model : 'gpt-4o',
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
    throw new Error(data?.error?.message || `OpenAI error ${res.status}`);
  }
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(prompt: string, model: string, apiKey: string): Promise<string> {
  // Gemini uses a different API shape. We map common aliases to stable model ids.
  const modelId = model.toLowerCase().includes('1.5-pro') ? 'gemini-1.5-pro-latest'
    : model.toLowerCase().includes('2.0') || model.toLowerCase().includes('gemini-2') ? 'gemini-2.0-flash'
    : 'gemini-1.5-flash-latest';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function callAnthropic(_prompt: string, _model: string, _apiKey: string): Promise<string> {
  // Placeholder — real Anthropic Messages API requires different headers/body.
  // For now we fall back gracefully if key is present but not fully wired.
  throw new Error('Anthropic/Claude direct support not yet implemented. Use Groq, OpenAI or Gemini.');
}

export async function generateSuggestions(question: string, transcriptSoFar?: string): Promise<string[]> {
  // Read current selected model from the global store (works from plain modules)
  const { settings } = useAppStore.getState();
  const aiModel: string = settings?.aiModel || 'groq-llama-3.1';

  const { provider, model } = resolveProviderAndModel(aiModel);
  const apiKey = await getLlmApiKey(provider);

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
 */
function float32ToInt16(float32Array: Float32Array): Int16Array {
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
  const { deepgram: DEEPGRAM_API_KEY } = await getKeys();

  // Read STT config from global store (consistent with LLM provider logic)
  const { settings } = useAppStore.getState();
  const sttProvider = (settings?.sttProvider as string) || 'deepgram';
  const sttModel = (settings?.sttModel as string) || 'nova-2';

  if (!DEEPGRAM_API_KEY) {
    console.warn('No Deepgram key — using mock transcription');
    return null;
  }

  // Use the actual mic sample rate reported by backend (fixes STT quality).
  // Deepgram accepts 16000, 44100, 48000 etc. as long as audio matches.
  // Model comes from settings (user-configurable in Settings page).
  const model = sttProvider === 'deepgram' ? sttModel : 'nova-2';

  const wsUrl = `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=${sampleRate}&channels=1&model=${encodeURIComponent(model)}&interim_results=true&smart_format=true&punctuate=true`;

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
        onTranscript(transcript, !!data.is_final);
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
