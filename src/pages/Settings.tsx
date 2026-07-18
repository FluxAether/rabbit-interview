import { useState, useEffect } from 'react'
import { Sun, Mic, Keyboard, Shield } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../i18n'
import { LANGUAGE_OPTIONS, SupportedLanguage, DEFAULT_LANGUAGE } from '../i18n/types'

type SettingsTab = 'general' | 'ai' | 'stealth' | 'audio' | 'shortcuts' | 'privacy'

export default function Settings() {
  const { settings, setLanguage: setStoreLanguage } = useAppStore()
  const t = useTranslation()

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: 'general', label: t('settings.tabs.general'), icon: Sun },
    { id: 'ai', label: t('settings.tabs.ai'), icon: Shield },
    { id: 'stealth', label: t('settings.tabs.stealth'), icon: Shield },
    { id: 'audio', label: t('settings.tabs.audio'), icon: Mic },
    { id: 'shortcuts', label: t('settings.tabs.shortcuts'), icon: Keyboard },
    { id: 'privacy', label: t('settings.tabs.privacy'), icon: Shield },
  ]

  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [theme, setTheme] = useState<'Light' | 'Dark' | 'System'>('Light')
  const [launchAtStartup, setLaunchAtStartup] = useState(true)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [updateChannel, setUpdateChannel] = useState<'Stable' | 'Beta'>('Stable')
  const [language, setLanguage] = useState<SupportedLanguage>(DEFAULT_LANGUAGE)
  const [aiModel, setAiModel] = useState('groq-llama-3.1')
  const [stealth, setStealth] = useState(true)

  // Initialize from store
  useEffect(() => {
    const storedLang = (settings?.language as SupportedLanguage) || DEFAULT_LANGUAGE
    setLanguage(storedLang)
  }, [settings?.language])

  const handleLanguageChange = (newLang: SupportedLanguage) => {
    setLanguage(newLang)
    setStoreLanguage(newLang)
  }

  const save = async () => {
    const payload = { theme, launchAtStartup, autoUpdate, updateChannel, language, aiModel, stealthEnabled: stealth }
    await invoke('save_settings', { settings: payload })
  }

  return (
    <div className="flex h-screen">
      {/* Settings Sidebar */}
      <div className="w-60 border-r border-[#e2e8f0] bg-[#f8fafc] p-4 pt-8">
        <div className="flex items-center gap-3 px-4 mb-6">
          <div className="w-8 h-8 rounded-xl bg-[#6366f1] flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div className="font-semibold">AI Desktop</div>
        </div>

        <div className="text-[10px] font-medium text-[#64748b] px-4 mb-2">SETTINGS</div>

        {tabs.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm rounded-xl mb-0.5 cursor-pointer ${active 
                ? 'bg-[#e0e7ff] text-[#4338ca] font-medium' 
                : 'text-[#475569] hover:bg-[#f1f5f9]'}`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </div>
          )
        })}
      </div>

      {/* Main Settings Content */}
      <div className="flex-1 p-8 overflow-auto">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight mb-1">{t('settings.title')}</h1>
          <p className="text-[#475569] mb-8">{t('settings.description')}</p>

          {/* Application Card */}
          <div className="card p-6 mb-4">
            <div className="font-semibold text-[#6366f1] mb-4">{t('settings.application')}</div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-3">
                  <Sun className="w-4 h-4 text-[#64748b]" />
                  <div>
                    <div className="font-medium">{t('settings.theme')}</div>
                    <div className="text-xs text-[#64748b]">{t('settings.themeDesc')}</div>
                  </div>
                </div>
                <select 
                  value={theme} 
                  onChange={(e) => setTheme(e.target.value as any)}
                  className="bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm"
                >
                  <option>Light</option>
                  <option>Dark</option>
                  <option>System</option>
                </select>
              </div>

              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-3">
                  <Mic className="w-4 h-4 text-[#64748b]" />
                  <div>
                    <div className="font-medium">{t('settings.launchAtStartup')}</div>
                    <div className="text-xs text-[#64748b]">{t('settings.launchAtStartupDesc')}</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={launchAtStartup} 
                    onChange={(e) => setLaunchAtStartup(e.target.checked)}
                    className="sr-only peer" 
                  />
                  <div className="w-9 h-5 bg-[#e2e8f0] peer-focus:outline-none peer-focus:ring-0 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#6366f1]"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Updates Card */}
          <div className="card p-6 mb-4">
            <div className="font-semibold text-[#6366f1] mb-4">{t('settings.updates')}</div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-3">
                  <Mic className="w-4 h-4 text-[#64748b]" />
                  <div>
                    <div className="font-medium">{t('settings.autoUpdate')}</div>
                    <div className="text-xs text-[#64748b]">{t('settings.autoUpdateDesc')}</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={autoUpdate} 
                    onChange={e => setAutoUpdate(e.target.checked)} 
                    className="sr-only peer" 
                  />
                  <div className="w-9 h-5 bg-[#e2e8f0] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#6366f1]"></div>
                </label>
              </div>

              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-3">
                  <Mic className="w-4 h-4 text-[#64748b]" />
                  <div>
                    <div className="font-medium">{t('settings.updateChannel')}</div>
                    <div className="text-xs text-[#64748b]">{t('settings.updateChannelDesc')}</div>
                  </div>
                </div>
                <select 
                  value={updateChannel} 
                  onChange={e => setUpdateChannel(e.target.value as any)}
                  className="bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm"
                >
                  <option>Stable</option>
                  <option>Beta</option>
                </select>
              </div>
            </div>
          </div>

          {/* Language */}
          <div className="card p-6">
            <div className="font-semibold text-[#6366f1] mb-4">{t('settings.language')}</div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-[#64748b]" />
                <div>
                  <div className="font-medium">{t('settings.language')}</div>
                  <div className="text-xs text-[#64748b]">{t('settings.languageDesc')}</div>
                </div>
              </div>
              <select 
                value={language} 
                onChange={e => handleLanguageChange(e.target.value as SupportedLanguage)}
                className="bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm min-w-[190px]"
              >
                {LANGUAGE_OPTIONS.map(opt => (
                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* AI Model Tab */}
          {activeTab === 'ai' && (
            <div className="card p-6 mb-4">
              <div className="font-semibold text-[#6366f1] mb-4">{t('settings.aiModel')}</div>
              <div className="space-y-3 text-sm">
                <div>{t('settings.aiModel.current')}: <span className="font-medium">{aiModel}</span></div>
                <select value={aiModel} onChange={e => setAiModel(e.target.value)} className="bg-white border rounded px-3 py-1 text-sm">
                  <option value="groq-llama-3.1">Groq Llama 3.1 (Fast)</option>
                  <option value="claude-3.5">Claude 3.5 Sonnet</option>
                  <option value="gpt-4o">GPT-4o</option>
                </select>
                <div className="text-xs text-[#64748b]">{t('settings.aiModel.lowLatency')}</div>

                <div className="pt-3 border-t">
                  <div className="font-medium mb-1">{t('settings.apiKeys')}</div>
                  <input 
                    className="w-full border rounded p-1 text-xs mb-1" 
                    placeholder="GROQ_API_KEY (secure store)"
                    onBlur={async (e) => {
                      const { setApiKey } = await import('../lib/keyStore');
                      const { clearKeyCache } = await import('../lib/llm');
                      await setApiKey('GROQ_API_KEY', e.target.value);
                      clearKeyCache();
                    }}
                    defaultValue="" // values are loaded from secure store at runtime
                  />
                  <input 
                    className="w-full border rounded p-1 text-xs" 
                    placeholder="DEEPGRAM_API_KEY (secure store)"
                    onBlur={async (e) => {
                      const { setApiKey } = await import('../lib/keyStore');
                      const { clearKeyCache } = await import('../lib/llm');
                      await setApiKey('DEEPGRAM_API_KEY', e.target.value);
                      clearKeyCache();
                    }}
                    defaultValue=""
                  />
                  <div className="text-[10px] text-[#64748b] mt-1">{t('settings.apiKeys.help')}</div>
                </div>
              </div>
            </div>
          )}

          {/* Stealth Mode */}
          {activeTab === 'stealth' && (
            <div className="card p-6">
              <div className="font-semibold text-[#6366f1] mb-3">{t('settings.stealth.title')}</div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={stealth} onChange={e => setStealth(e.target.checked)} />
                <span>{t('settings.stealth.desc')}</span>
              </label>
              <p className="text-xs mt-2 text-[#64748b]">{t('settings.stealth.note')}</p>
            </div>
          )}

          {/* Audio Capture */}
          {activeTab === 'audio' && (
            <div className="card p-6">
              <div className="font-semibold text-[#6366f1] mb-3">{t('settings.audio.title')}</div>
              <div className="text-sm mb-2">{t('settings.audio.device')}</div>

              <button 
                onClick={async () => {
                  const { invoke } = await import('@tauri-apps/api/core');
                  const devices = await invoke<string[]>('list_audio_devices');
                  alert(t('settings.audio.listDevices') + ':\n' + devices.join('\n'));
                }} 
                className="text-xs px-3 py-1 border rounded mb-3"
              >
                {t('settings.audio.listDevices')}
              </button>

              <div className="text-xs p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
                <div><b>{t('settings.audio.blackhole.title')}</b></div>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>{t('settings.audio.blackhole.step1')}</li>
                  <li>{t('settings.audio.blackhole.step2')}</li>
                  <li>{t('settings.audio.blackhole.step3')}</li>
                  <li>{t('settings.audio.blackhole.step4')}</li>
                </ol>
                <div className="pt-1">{t('settings.audio.blackhole.alt')}</div>
                <div className="pt-1 text-[10px]">{t('settings.audio.blackhole.advanced')}</div>
              </div>
            </div>
          )}

          {/* Shortcuts */}
          {activeTab === 'shortcuts' && (
            <div className="card p-6">
              <div className="font-semibold text-[#6366f1] mb-3">{t('settings.shortcuts.title')}</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>{t('settings.shortcuts.toggle')}</span> <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded">⌘⇧I</span></div>
                <div className="flex justify-between"><span>{t('settings.shortcuts.capture')}</span> <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded">⌘⇧C</span></div>
                <div className="flex justify-between"><span>{t('settings.shortcuts.mock')}</span> <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded">⌘⇧M</span></div>
              </div>
            </div>
          )}

          {/* Privacy */}
          {activeTab === 'privacy' && (
            <div className="card p-6">
              <div className="font-semibold text-[#6366f1] mb-3">{t('settings.privacy.title')}</div>
              <p className="text-sm">{t('settings.privacy.desc')}</p>
              <button onClick={() => alert('All local data cleared (demo)')} className="mt-4 text-red-600 text-sm">{t('settings.privacy.clear')}</button>
            </div>
          )}

          <button onClick={save} className="mt-6 px-5 py-2 bg-[#6366f1] text-white text-sm rounded-2xl">{t('common.save')}</button>

          <div className="mt-8 text-xs text-[#64748b] flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" /> {t('settings.secureNote')}
          </div>

          {/* Saved indicator matching design */}
          <div className="fixed bottom-6 right-8 bg-white shadow border border-[#e2e8f0] text-sm px-4 py-2 rounded-2xl flex items-center gap-2 text-[#166534]">
            <div className="w-5 h-5 rounded-full bg-[#22c55e] flex items-center justify-center">
              <span className="text-white text-[10px]">✓</span>
            </div>
            {t('settings.saved')}
          </div>
        </div>
      </div>
    </div>
  )
}
