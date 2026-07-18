import { useState } from 'react'
import { Sun, Mic, Keyboard, Shield } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { invoke } from '@tauri-apps/api/core'

type SettingsTab = 'general' | 'ai' | 'stealth' | 'audio' | 'shortcuts' | 'privacy'

const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: 'general', label: 'General', icon: Sun },
  { id: 'ai', label: 'AI Model', icon: Shield },
  { id: 'stealth', label: 'Stealth Mode', icon: Shield },
  { id: 'audio', label: 'Audio Capture', icon: Mic },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'privacy', label: 'Privacy', icon: Shield },
]

export default function Settings() {
  useAppStore()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [theme, setTheme] = useState<'Light' | 'Dark' | 'System'>('Light')
  const [launchAtStartup, setLaunchAtStartup] = useState(true)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [updateChannel, setUpdateChannel] = useState<'Stable' | 'Beta'>('Stable')
  const [language, setLanguage] = useState('English (United States)')
  const [aiModel, setAiModel] = useState('groq-llama-3.1')
  const [stealth, setStealth] = useState(true)

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
          <h1 className="text-3xl font-semibold tracking-tight mb-1">General</h1>
          <p className="text-[#475569] mb-8">Configure general application settings.</p>

          {/* Application Card */}
          <div className="card p-6 mb-4">
            <div className="font-semibold text-[#6366f1] mb-4">Application</div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-3">
                  <Sun className="w-4 h-4 text-[#64748b]" />
                  <div>
                    <div className="font-medium">Theme</div>
                    <div className="text-xs text-[#64748b]">Choose application appearance</div>
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
                    <div className="font-medium">Launch at startup</div>
                    <div className="text-xs text-[#64748b]">Start AI Desktop when you log in</div>
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
            <div className="font-semibold text-[#6366f1] mb-4">Updates</div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-3">
                  <Mic className="w-4 h-4 text-[#64748b]" />
                  <div>
                    <div className="font-medium">Check for updates automatically</div>
                    <div className="text-xs text-[#64748b]">Keep the app up to date</div>
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
                    <div className="font-medium">Update channel</div>
                    <div className="text-xs text-[#64748b]">Choose the update stream</div>
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
            <div className="font-semibold text-[#6366f1] mb-4">Language</div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-[#64748b]" />
                <div>
                  <div className="font-medium">Language</div>
                  <div className="text-xs text-[#64748b]">Choose your preferred language</div>
                </div>
              </div>
              <select 
                value={language} 
                onChange={e => setLanguage(e.target.value)}
                className="bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm min-w-[190px]"
              >
                <option>English (United States)</option>
                <option>简体中文</option>
                <option>繁體中文</option>
              </select>
            </div>
          </div>

          {/* AI Model Tab */}
          {activeTab === 'ai' && (
            <div className="card p-6 mb-4">
              <div className="font-semibold text-[#6366f1] mb-4">AI Model</div>
              <div className="space-y-3 text-sm">
                <div>Current model: <span className="font-medium">{aiModel}</span></div>
                <select value={aiModel} onChange={e => setAiModel(e.target.value)} className="bg-white border rounded px-3 py-1 text-sm">
                  <option value="groq-llama-3.1">Groq Llama 3.1 (Fast)</option>
                  <option value="claude-3.5">Claude 3.5 Sonnet</option>
                  <option value="gpt-4o">GPT-4o</option>
                </select>
                <div className="text-xs text-[#64748b]">Lower latency recommended for real-time Copilot.</div>

                <div className="pt-3 border-t">
                  <div className="font-medium mb-1">API Keys (localStorage - for development)</div>
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
                  <div className="text-[10px] text-[#64748b] mt-1">Reload app after setting keys. Use Settings for production secure storage.</div>
                </div>
              </div>
            </div>
          )}

          {/* Stealth Mode */}
          {activeTab === 'stealth' && (
            <div className="card p-6">
              <div className="font-semibold text-[#6366f1] mb-3">Stealth Mode</div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={stealth} onChange={e => setStealth(e.target.checked)} />
                <span>Hide from screen recordings &amp; screen sharing (where supported)</span>
              </label>
              <p className="text-xs mt-2 text-[#64748b]">On macOS full system stealth has limitations. Use the floating utility window + hotkey for best results.</p>
            </div>
          )}

          {/* Audio Capture */}
          {activeTab === 'audio' && (
            <div className="card p-6">
              <div className="font-semibold text-[#6366f1] mb-3">Audio Capture</div>
              <div className="text-sm mb-2">Preferred device: System Default Microphone</div>

              <button 
                onClick={async () => {
                  const { invoke } = await import('@tauri-apps/api/core');
                  const devices = await invoke<string[]>('list_audio_devices');
                  alert('Available input devices:\n' + devices.join('\n'));
                }} 
                className="text-xs px-3 py-1 border rounded mb-3"
              >
                List Audio Devices
              </button>

              <div className="text-xs p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
                <div><b>macOS System Audio (recommended for interviews):</b></div>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Download BlackHole 2ch from <a href="https://github.com/ExistentialAudio/BlackHole" target="_blank" className="underline">GitHub</a> (free)</li>
                  <li>Open "Audio MIDI Setup" → Create Aggregate Device</li>
                  <li>Check your mic + "BlackHole 2ch"</li>
                  <li>Select the Aggregate Device in the app or system settings</li>
                </ol>
                <div className="pt-1">Alternative: Use Loopback (paid) for easier virtual routing.</div>
                <div className="pt-1 text-[10px]">For advanced: ScreenCaptureKit can capture app audio + mic (requires macOS 12.3+ and screen recording permission).</div>
              </div>
            </div>
          )}

          {/* Shortcuts */}
          {activeTab === 'shortcuts' && (
            <div className="card p-6">
              <div className="font-semibold text-[#6366f1] mb-3">Keyboard Shortcuts</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Toggle Stealth Copilot</span> <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded">⌘⇧I</span></div>
                <div className="flex justify-between"><span>Start / Stop Capture</span> <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded">⌘⇧C</span></div>
                <div className="flex justify-between"><span>Quick Launch Mock Interview</span> <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded">⌘⇧M</span></div>
              </div>
            </div>
          )}

          {/* Privacy */}
          {activeTab === 'privacy' && (
            <div className="card p-6">
              <div className="font-semibold text-[#6366f1] mb-3">Privacy</div>
              <p className="text-sm">All data is stored locally. No data is sent to our servers without your explicit action.</p>
              <button onClick={() => alert('All local data cleared (demo)')} className="mt-4 text-red-600 text-sm">Clear all local data</button>
            </div>
          )}

          <button onClick={save} className="mt-6 px-5 py-2 bg-[#6366f1] text-white text-sm rounded-2xl">Save Changes</button>

          <div className="mt-8 text-xs text-[#64748b] flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" /> Your settings are saved securely locally.
          </div>

          {/* Saved indicator matching design */}
          <div className="fixed bottom-6 right-8 bg-white shadow border border-[#e2e8f0] text-sm px-4 py-2 rounded-2xl flex items-center gap-2 text-[#166534]">
            <div className="w-5 h-5 rounded-full bg-[#22c55e] flex items-center justify-center">
              <span className="text-white text-[10px]">✓</span>
            </div>
            All changes saved
          </div>
        </div>
      </div>
    </div>
  )
}
