import { invoke } from '@tauri-apps/api/core'

/**
 * Permission helpers for audio capture (mic + macOS Screen Recording).
 *
 * Usage before starting capture:
 *   if (useSystemAudio && !(await checkScreenRecordingPermission())) {
 *     await openScreenRecordingSettings()
 *     // show message and return
 *   }
 *   if (needsMic && !(await tryRequestMicrophone())) {
 *     await openMicrophoneSettings()
 *     // show message and return
 *   }
 */

export async function checkScreenRecordingPermission(): Promise<boolean> {
  try {
    return await invoke<boolean>('check_screen_recording_permission')
  } catch {
    return false
  }
}

export async function openScreenRecordingSettings(): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  // Directly open macOS System Settings for Screen Recording permission.
  // Try the most specific deep link first.
  const urls = [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    'x-apple.systempreferences:com.apple.Settings.PrivacySecurity', // newer macOS
    'x-apple.systempreferences:com.apple.preference.security?Privacy' // fallback
  ]
  for (const url of urls) {
    try {
      await openUrl(url)
      return
    } catch (e) {
      console.warn(`Failed to open ${url}`, e)
    }
  }
}

export async function openMicrophoneSettings(): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  } catch (e) {
    console.warn('Failed to open microphone settings', e)
  }
}

/**
 * Check-only helpers. Callers are responsible for calling the open* functions
 * and showing UI messages when permission is missing.
 *
 * Recommended pattern before starting capture:
 *   if (useSystemAudio) {
 *     if (!await checkScreenRecordingPermission()) {
 *       await openScreenRecordingSettings();
 *       setStatus(...);
 *       return;
 *     }
 *   }
 *   if (needsMic) {
 *     if (!await tryRequestMicrophone()) {
 *       await openMicrophoneSettings();
 *       setStatus(...);
 *       return;
 *     }
 *   }
 */
export async function tryRequestMicrophone(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}
