import {
  loadAppSettingsJson,
  migrateLegacyJsonStoresIfNeeded,
  saveAppSettingsJson,
} from './db';
import { encryptSecret } from './secretCrypto';

export type SttLanguage = 'zh-CN' | 'zh-TW' | 'en-US' | 'multi';
export type AiAccessMode = 'byok' | 'hosted';
export type SttProvider = 'deepgram' | 'gemini' | 'apple' | 'hosted';
export type CopilotFontSize = 'sm' | 'base' | 'lg';

export const GEMINI_LIVE_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live';
export const GEMINI_LIVE_TRANSLATE_MODEL = 'gemini-3.5-live-translate-preview';
export const APPLE_STT_MODEL = 'speech-transcriber';
export const HOSTED_STT_MODEL = 'volcengine-bigmodel';

export interface AppSettings {
  theme: 'Light' | 'Dark' | 'System';
  autoUpdate: boolean;
  updateChannel: 'Stable' | 'Beta';
  language: string;
  aiModel: string;
  aiAccessMode: AiAccessMode;
  stealthEnabled: boolean;
  // Per-provider last selected models (so UI remembers choices)
  aiModels?: Record<string, string>;
  // STT
  sttProvider: SttProvider;
  sttModel: string;
  sttLanguage: SttLanguage;
  // Stealth Copilot capture mode (persisted so floating window + restarts respect choice)
  useSystemAudio?: boolean;
  useMicWithSystem?: boolean;
  micDevice?: string;
  // Stealth Copilot floating panel message font size
  copilotFontSize?: CopilotFontSize;
  // Stealth Copilot show or hide user bubbles
  copilotShowMyBubbles?: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'Light',
  autoUpdate: true,
  updateChannel: 'Stable',
  language: 'zh-CN',
  aiModel: 'groq-llama-3.1',
  aiAccessMode: 'byok',
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
  useMicWithSystem: false,
  copilotFontSize: 'base',
  copilotShowMyBubbles: true,
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
  if (!aiModels.gemini || !['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'].includes(aiModels.gemini)) {
    aiModels.gemini = 'gemini-3.6-flash';
  }

  let aiModel = saved?.aiModel || DEFAULT_SETTINGS.aiModel;
  if (aiModel.startsWith('claude-3')) aiModel = 'claude-haiku-4-5';
  if (aiModel.startsWith('gpt-4')) aiModel = 'gpt-5.6-luna';
  if (aiModel === 'gemma2-9b-it') aiModel = 'llama-3.1-8b-instant';
  if (aiModel.startsWith('gemini') && !['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'].includes(aiModel)) {
    aiModel = 'gemini-3.6-flash';
  }
  const aiAccessMode: AiAccessMode = saved?.aiAccessMode === 'hosted' ? 'hosted' : 'byok';
  const savedSttProvider = saved?.sttProvider as string | undefined;
  const sttProvider: SttProvider = savedSttProvider === 'hosted'
    ? 'hosted'
    : savedSttProvider === 'gemini'
    ? 'gemini'
    : savedSttProvider === 'apple'
      ? 'apple'
      : 'deepgram';
  const sttModel = sttProvider === 'hosted'
    ? HOSTED_STT_MODEL
    : sttProvider === 'gemini'
    ? saved?.sttModel === GEMINI_LIVE_TRANSCRIBE_MODEL
      ? GEMINI_LIVE_TRANSCRIBE_MODEL
      : GEMINI_LIVE_TRANSLATE_MODEL
    : sttProvider === 'apple'
      ? APPLE_STT_MODEL
      : savedSttProvider !== undefined && savedSttProvider !== 'deepgram'
        ? DEFAULT_SETTINGS.sttModel
        : saved?.sttModel === 'nova-2'
          ? 'nova-3'
          : (saved?.sttModel || DEFAULT_SETTINGS.sttModel);
  const copilotFontSize: CopilotFontSize =
    saved?.copilotFontSize === 'sm' || saved?.copilotFontSize === 'base' || saved?.copilotFontSize === 'lg'
      ? saved.copilotFontSize
      : DEFAULT_SETTINGS.copilotFontSize!;
  const useMicWithSystem = saved?.useMicWithSystem === undefined
    ? DEFAULT_SETTINGS.useMicWithSystem
    : Boolean(saved.useMicWithSystem);
  const copilotShowMyBubbles = saved?.copilotShowMyBubbles === undefined
    ? DEFAULT_SETTINGS.copilotShowMyBubbles!
    : Boolean(saved.copilotShowMyBubbles);
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    aiModel,
    aiAccessMode,
    aiModels,
    sttProvider,
    sttModel,
    copilotFontSize,
    useMicWithSystem,
    copilotShowMyBubbles,
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
