// Real LLM + STT integration hooks using secure tauri-plugin-store
import { loadApiKeys } from './keyStore';

let cachedKeys: { groq: string; deepgram: string } | null = null;

export function clearKeyCache() {
  cachedKeys = null;
}

async function getKeys() {
  if (!cachedKeys) {
    cachedKeys = await loadApiKeys();
  }
  return cachedKeys;
}

export async function generateSuggestions(question: string, transcriptSoFar?: string): Promise<string[]> {
  const { groq: GROQ_API_KEY } = await getKeys();

  if (!GROQ_API_KEY) {
    // Fallback to smart mock
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
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'You are an expert interview coach. Return 4-5 concise bullet points in STAR format for the given interviewer question. Be specific and professional.' },
          { role: 'user', content: `Interviewer question: ${question}\nPrevious context: ${transcriptSoFar || 'none'}` }
        ],
        temperature: 0.6,
        max_tokens: 220,
      }),
    });

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    return text.split('\n').filter((l: string) => l.trim().length > 3).slice(0, 6);
  } catch (e) {
    return [`Error calling Groq: ${e}`];
  }
}

// ==================== Deepgram Streaming with PCM Conversion ====================

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
  onError?: (err: any) => void
): Promise<WebSocket | null> {
  const { deepgram: DEEPGRAM_API_KEY } = await getKeys();
  if (!DEEPGRAM_API_KEY) {
    console.warn('No Deepgram key — using mock transcription');
    return null;
  }

  const wsUrl = `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&model=nova-2&interim_results=true&smart_format=true&punctuate=true`;

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
