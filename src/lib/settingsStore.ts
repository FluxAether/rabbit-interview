import { Store } from '@tauri-apps/plugin-store';

let store: Store | null = null;

export type SttLanguage = 'zh-CN' | 'zh-TW' | 'en-US' | 'multi';
export type CopilotFontSize = 'sm' | 'base' | 'lg';

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('app-settings.json');
  }
  return store;
}

export interface AppSettings {
  theme: 'Light' | 'Dark' | 'System';
  launchAtStartup: boolean;
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
  launchAtStartup: true,
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

export async function loadAppSettings(): Promise<AppSettings> {
  const s = await getStore();
  const saved = await s.get<Partial<AppSettings>>('settings');
  const savedModels = saved?.aiModels || {};
  const aiModels = {
    ...DEFAULT_SETTINGS.aiModels,
    ...savedModels,
  };
  if (aiModels.anthropic?.startsWith('claude-3')) aiModels.anthropic = 'claude-haiku-4-5';
  if (aiModels.openai?.startsWith('gpt-4')) aiModels.openai = 'gpt-5.6-luna';
  if (aiModels.groq === 'gemma2-9b-it') aiModels.groq = 'llama-3.1-8b-instant';
  if (!aiModels.gemini || !['gemini-3.5-flash', 'gemini-3.6-flash'].includes(aiModels.gemini)) {
    aiModels.gemini = 'gemini-3.6-flash';
  }

  let aiModel = saved?.aiModel || DEFAULT_SETTINGS.aiModel;
  if (aiModel.startsWith('claude-3')) aiModel = 'claude-haiku-4-5';
  if (aiModel.startsWith('gpt-4')) aiModel = 'gpt-5.6-luna';
  if (aiModel === 'gemma2-9b-it') aiModel = 'llama-3.1-8b-instant';
  if (aiModel.startsWith('gemini') && !['gemini-3.5-flash', 'gemini-3.6-flash'].includes(aiModel)) {
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

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  const s = await getStore();
  const current = await loadAppSettings();
  const merged = {
    ...current,
    ...settings,
    // preserve/merge aiModels
    aiModels: {
      ...current.aiModels,
      ...(settings.aiModels || {}),
    },
  };
  await s.set('settings', merged);
  await s.save();
}

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K] | undefined> {
  const settings = await loadAppSettings();
  return settings[key];
}
