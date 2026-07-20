import { invoke } from '@tauri-apps/api/core'
import { loadAppSettings } from './settingsStore'

export interface CopilotWindowStatus {
  visible: boolean
  protection_requested: boolean
  protection_applied: boolean
  error: string | null
}

async function protectionRequested(): Promise<boolean> {
  const settings = await loadAppSettings()
  return settings.stealthEnabled
}

export async function showCopilotWindow(): Promise<CopilotWindowStatus> {
  return invoke('show_copilot_window', { protected: await protectionRequested() })
}

export async function toggleCopilotWindow(): Promise<CopilotWindowStatus> {
  return invoke('toggle_copilot_window', { protected: await protectionRequested() })
}

export async function hideCopilotWindow(): Promise<CopilotWindowStatus> {
  return invoke('hide_copilot_window')
}

export async function getCopilotWindowStatus(): Promise<CopilotWindowStatus> {
  return invoke('get_copilot_window_status')
}
