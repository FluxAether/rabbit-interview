import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useAppStore } from '../stores/useAppStore'

const WINDOW_STATUS_EVENT = 'copilot-window-status'

export interface CopilotWindowStatus {
  visible: boolean
  protection_requested: boolean
  protection_applied: boolean
  platform_supported: boolean
  request_dispatched: boolean
  error: string | null
}

async function protectionRequested(): Promise<boolean> {
  return Boolean(useAppStore.getState().settings.stealthEnabled)
}

async function publish(status: CopilotWindowStatus): Promise<CopilotWindowStatus> {
  await emit(WINDOW_STATUS_EVENT, status)
  return status
}

export async function showCopilotWindow(): Promise<CopilotWindowStatus> {
  return publish(await invoke('show_copilot_window', { protected: await protectionRequested() }))
}

export async function toggleCopilotWindow(): Promise<CopilotWindowStatus> {
  return publish(await invoke('toggle_copilot_window', { protected: await protectionRequested() }))
}

export async function hideCopilotWindow(): Promise<CopilotWindowStatus> {
  return publish(await invoke('hide_copilot_window'))
}

export async function setCopilotWindowOpacity(opacity: number): Promise<void> {
  await invoke('set_copilot_window_opacity', { opacity })
}

export async function getCopilotWindowStatus(): Promise<CopilotWindowStatus> {
  return invoke('get_copilot_window_status')
}

export async function subscribeCopilotWindowStatus(
  listener: (status: CopilotWindowStatus) => void,
): Promise<UnlistenFn> {
  return listen<CopilotWindowStatus>(WINDOW_STATUS_EVENT, (event) => listener(event.payload))
}
