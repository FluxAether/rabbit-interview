export async function openMicrophoneSettings(): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  } catch (e) {
    console.warn('Failed to open microphone settings', e)
  }
}

export async function tryRequestMicrophone(): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core')
  const status = await invoke<string>('request_microphone_permission_command').catch(() => 'denied')
  return status === 'granted'
}
