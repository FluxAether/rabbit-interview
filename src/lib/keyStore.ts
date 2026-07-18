import { Store } from '@tauri-apps/plugin-store';

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('keys.json'); // Stored in app data dir, more secure than localStorage
  }
  return store;
}

export async function setApiKey(key: 'GROQ_API_KEY' | 'DEEPGRAM_API_KEY', value: string): Promise<void> {
  const s = await getStore();
  await s.set(key, value);
  await s.save();
}

export async function getApiKey(key: 'GROQ_API_KEY' | 'DEEPGRAM_API_KEY'): Promise<string | null> {
  const s = await getStore();
  const val = await s.get<string>(key);
  return val ?? null;
}

export async function clearApiKeys(): Promise<void> {
  const s = await getStore();
  await s.delete('GROQ_API_KEY');
  await s.delete('DEEPGRAM_API_KEY');
  await s.save();
}

// For convenience in llm.ts
export async function loadApiKeys(): Promise<{ groq: string; deepgram: string }> {
  return {
    groq: (await getApiKey('GROQ_API_KEY')) || '',
    deepgram: (await getApiKey('DEEPGRAM_API_KEY')) || '',
  };
}