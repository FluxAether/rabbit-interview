import { invoke } from '@tauri-apps/api/core'
import {
  clearSecrets,
  deleteSecret,
  loadSecret,
  migrateLegacyJsonStoresIfNeeded,
  saveSecret,
} from './db';
import { decryptSecret, encryptSecret } from './secretCrypto';
import { requireAppAccess } from './hostedAuth';

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

async function deleteFromKeychain(key: ApiKeyName): Promise<void> {
  try {
    await invoke('delete_secure_secret', { key })
  } catch (error) {
    console.warn('Secure secret delete failed', error)
  }
}

export async function setApiKey(key: ApiKeyName, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) await requireAppAccess(true);
  await ensureMigrated();
  if (!trimmed) {
    await deleteSecret(key);
    await deleteFromKeychain(key);
    return;
  }
  await saveSecret(key, encryptSecret(trimmed));
  await deleteFromKeychain(key);
}

export async function getApiKey(key: ApiKeyName): Promise<string | null> {
  await ensureMigrated();
  const stored = decryptSecret(await loadSecret(key));
  if (stored) return stored;
  const leftover = await loadFromKeychain(key);
  if (!leftover) return null;
  await saveSecret(key, encryptSecret(leftover));
  await deleteFromKeychain(key);
  return leftover;
}

export async function clearApiKeys(): Promise<void> {
  await ensureMigrated();
  await clearSecrets(ALL_KEYS);
  await Promise.all(ALL_KEYS.map((key) => deleteFromKeychain(key)));
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
