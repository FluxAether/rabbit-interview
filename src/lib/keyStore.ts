import { invoke } from '@tauri-apps/api/core'
import {
  clearSecrets,
  deleteSecret,
  loadSecret,
  migrateLegacyJsonStoresIfNeeded,
  saveSecret,
} from './db';
import { decryptSecret, encryptSecret } from './secretCrypto';

export type LlmProviderKey = 'GROQ_API_KEY' | 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY';
export type SttProviderKey = 'DEEPGRAM_API_KEY';
export type ApiKeyName = LlmProviderKey | SttProviderKey;

const ALL_KEYS: ApiKeyName[] = [
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'DEEPGRAM_API_KEY',
];

async function ensureMigrated(): Promise<void> {
  await migrateLegacyJsonStoresIfNeeded(encryptSecret);
}

async function loadFromKeychain(key: ApiKeyName): Promise<string | null> {
  try {
    const value = await invoke<string | null>('load_secure_secret', { key })
    return value?.trim() ? value : null
  } catch {
    return null
  }
}

async function saveToKeychain(key: ApiKeyName, value: string): Promise<boolean> {
  try {
    await invoke('save_secure_secret', { key, value })
    return true
  } catch (error) {
    console.warn('Secure secret save failed', error)
    return false
  }
}

async function deleteFromKeychain(key: ApiKeyName): Promise<void> {
  try {
    await invoke('delete_secure_secret', { key })
  } catch (error) {
    console.warn('Secure secret delete failed', error)
  }
}

export async function setApiKey(key: ApiKeyName, value: string): Promise<void> {
  await ensureMigrated();
  const trimmed = value.trim();
  if (!trimmed) {
    await deleteFromKeychain(key);
    await deleteSecret(key);
    return;
  }
  const storedSecurely = await saveToKeychain(key, trimmed);
  if (storedSecurely) {
    await deleteSecret(key);
    return;
  }
  await saveSecret(key, encryptSecret(trimmed));
}

export async function getApiKey(key: ApiKeyName): Promise<string | null> {
  await ensureMigrated();
  const secure = await loadFromKeychain(key);
  if (secure) {
    await deleteSecret(key).catch(() => {});
    return secure;
  }
  const legacy = decryptSecret(await loadSecret(key));
  if (!legacy) return null;
  if (await saveToKeychain(key, legacy)) {
    await deleteSecret(key).catch(() => {});
  }
  return legacy;
}

export async function clearApiKeys(): Promise<void> {
  await ensureMigrated();
  await Promise.all(ALL_KEYS.map((key) => deleteFromKeychain(key)));
  await clearSecrets(ALL_KEYS);
}

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
