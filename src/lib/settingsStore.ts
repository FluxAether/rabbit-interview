import {
  loadAppSettingsJson,
  migrateLegacyJsonStoresIfNeeded,
  saveAppSettingsJson,
} from './db';
import { encryptSecret } from './secretCrypto';

export type SttLanguage = 'zh-CN' | 'zh-TW' | 'en-US' | 'multi';
export type CopilotFontSize = 'sm' | 'base' | 'lg';

export interface AppSettings {
  theme: 'Light' | 'Dark' | 'System';
  autoUpdate: boolean;
  updateChannel: 'Stable' | 'Beta';
  language: string;
  aiModel: string;
  stealthEnabled: boolean;
  // Per-provider last selected models (so UI remembers choices)
  aiModels?: Record<string, string>;
  // STT
  sttProvider: string;
  sttModel: string;
  sttLanguage: SttLanguage;
  // Stealth Copilot capture mode (persisted so floating window + restarts respect choice)
  useSystemAudio?: boolean;
  useMicWithSystem?: boolean;
  micDevice?: string;
  // Stealth Copilot floating panel message font size
  copilotFontSize?: CopilotFontSize;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'Light',
  autoUpdate: true,
  updateChannel: 'Stable',
  language: 'zh-CN',
  aiModel: 'groq-llama-3.1',
  stealthEnabled: true,
  aiModels: {
    groq: 'llama-3.1-8b-instant',
    openai: 'gpt-5.6-luna',
    anthropic: 'claude-haiku-4-5',
    gemini: 'gemini-3.6-flash',
  },
  sttProvider: 'deepgram',
  sttModel: 'nova-3',
  sttLanguage: 'zh-CN',
  useSystemAudio: true,
  useMicWithSystem: true,
  copilotFontSize: 'base',
};

function normalizeSettings(saved?: Partial<AppSettings> | null): AppSettings {
  const savedModels = saved?.aiModels || {};
  const aiModels = {
    ...DEFAULT_SETTINGS.aiModels,
    ...savedModels,
  };
  if (aiModels.anthropic?.startsWith('claude-3')) aiModels.anthropic = 'claude-haiku-4-5';
  if (aiModels.openai?.startsWith('gpt-4')) aiModels.openai = 'gpt-5.6-luna';
  if (aiModels.groq === 'gemma2-9b-it') aiModels.groq = 'llama-3.1-8b-instant';
  if (!aiModels.gemini || !['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash'].includes(aiModels.gemini)) {
    aiModels.gemini = 'gemini-3.6-flash';
  }

  let aiModel = saved?.aiModel || DEFAULT_SETTINGS.aiModel;
  if (aiModel.startsWith('claude-3')) aiModel = 'claude-haiku-4-5';
  if (aiModel.startsWith('gpt-4')) aiModel = 'gpt-5.6-luna';
  if (aiModel === 'gemma2-9b-it') aiModel = 'llama-3.1-8b-instant';
  if (aiModel.startsWith('gemini') && !['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash'].includes(aiModel)) {
    aiModel = 'gemini-3.6-flash';
  }
  const sttModel = saved?.sttModel === 'nova-2' ? 'nova-3' : (saved?.sttModel || DEFAULT_SETTINGS.sttModel);
  const copilotFontSize: CopilotFontSize =
    saved?.copilotFontSize === 'sm' || saved?.copilotFontSize === 'base' || saved?.copilotFontSize === 'lg'
      ? saved.copilotFontSize
      : DEFAULT_SETTINGS.copilotFontSize!;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    aiModel,
    aiModels,
    sttModel,
    copilotFontSize,
  } as AppSettings;
}

async function ensureMigrated(): Promise<void> {
  await migrateLegacyJsonStoresIfNeeded(encryptSecret);
}

export async function loadAppSettings(): Promise<AppSettings> {
  await ensureMigrated();
  const raw = await loadAppSettingsJson();
  if (!raw) return { ...DEFAULT_SETTINGS, aiModels: { ...DEFAULT_SETTINGS.aiModels } };
  try {
    return normalizeSettings(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return { ...DEFAULT_SETTINGS, aiModels: { ...DEFAULT_SETTINGS.aiModels } };
  }
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  await ensureMigrated();
  const current = await loadAppSettings();
  const merged = normalizeSettings({
    ...current,
    ...settings,
    aiModels: {
      ...current.aiModels,
      ...(settings.aiModels || {}),
    },
  });
  await saveAppSettingsJson(JSON.stringify(merged));
}
