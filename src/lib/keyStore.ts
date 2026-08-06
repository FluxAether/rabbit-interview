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

export async function setApiKey(key: ApiKeyName, value: string): Promise<void> {
  await ensureMigrated();
  const trimmed = value.trim();
  if (!trimmed) {
    await deleteSecret(key);
    return;
  }
  await saveSecret(key, encryptSecret(trimmed));
}

export async function getApiKey(key: ApiKeyName): Promise<string | null> {
  await ensureMigrated();
  return decryptSecret(await loadSecret(key));
}

export async function clearApiKeys(): Promise<void> {
  await ensureMigrated();
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
