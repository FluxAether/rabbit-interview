import { Store } from '@tauri-apps/plugin-store';

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('keys.json'); // Stored in the app data directory; the file is not encrypted.
  }
  return store;
}

export type LlmProviderKey = 'GROQ_API_KEY' | 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY';
export type SttProviderKey = 'DEEPGRAM_API_KEY';
export type ApiKeyName = LlmProviderKey | SttProviderKey;

export async function setApiKey(key: ApiKeyName, value: string): Promise<void> {
  const s = await getStore();
  await s.set(key, value);
  await s.save();
}

export async function getApiKey(key: ApiKeyName): Promise<string | null> {
  const s = await getStore();
  const val = await s.get<string>(key);
  return val ?? null;
}

export async function clearApiKeys(): Promise<void> {
  const s = await getStore();
  await s.delete('GROQ_API_KEY');
  await s.delete('OPENAI_API_KEY');
  await s.delete('ANTHROPIC_API_KEY');
  await s.delete('GEMINI_API_KEY');
  await s.delete('DEEPGRAM_API_KEY');
  await s.save();
}

// For convenience in llm.ts — extended with Gemini support
export async function loadApiKeys(): Promise<{
  groq: string;
  openai: string;
  anthropic: string;
  gemini: string;
  deepgram: string;
}> {
  return {
    groq: (await getApiKey('GROQ_API_KEY')) || '',
    openai: (await getApiKey('OPENAI_API_KEY')) || '',
    anthropic: (await getApiKey('ANTHROPIC_API_KEY')) || '',
    gemini: (await getApiKey('GEMINI_API_KEY')) || '',
    deepgram: (await getApiKey('DEEPGRAM_API_KEY')) || '',
  };
}

export async function getLlmApiKey(provider: 'groq' | 'openai' | 'anthropic' | 'gemini'): Promise<string> {
  const keyName: LlmProviderKey =
    provider === 'groq' ? 'GROQ_API_KEY' :
    provider === 'openai' ? 'OPENAI_API_KEY' :
    provider === 'anthropic' ? 'ANTHROPIC_API_KEY' :
    'GEMINI_API_KEY';
  return (await getApiKey(keyName)) || '';
}
