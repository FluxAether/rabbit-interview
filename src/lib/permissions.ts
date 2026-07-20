export async function openMicrophoneSettings(): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  } catch (e) {
    console.warn('Failed to open microphone settings', e)
  }
}

export async function tryRequestMicrophone(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}
