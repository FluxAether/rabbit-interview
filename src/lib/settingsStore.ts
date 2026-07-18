import { Store } from '@tauri-apps/plugin-store';

let store: Store | null = null;

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
  // Stealth Copilot capture mode (persisted so floating window + restarts respect choice)
  useSystemAudio?: boolean;
  useMicWithSystem?: boolean;
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
    openai: 'gpt-4o',
    anthropic: 'claude-3-5-sonnet-20241022',
    gemini: 'gemini-3.5-flash',
  },
  sttProvider: 'deepgram',
  sttModel: 'nova-2',
  useSystemAudio: true,
  useMicWithSystem: true,
};

export async function loadAppSettings(): Promise<AppSettings> {
  const s = await getStore();
  const saved = await s.get<Partial<AppSettings>>('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    // merge aiModels deeply
    aiModels: {
      ...DEFAULT_SETTINGS.aiModels,
      ...(saved?.aiModels || {}),
    },
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
