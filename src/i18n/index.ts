import { useAppStore } from '../stores/useAppStore'
import { SupportedLanguage, DEFAULT_LANGUAGE } from './types'
import { getTranslations } from './translations'

/**
 * Lightweight i18n hook.
 * Usage:
 *   const t = useTranslation()
 *   t('nav.dashboard')  // => "Dashboard" or "仪表盘"
 */
export function useTranslation() {
  const language = useAppStore((state) => {
    const lang = state.settings?.language as SupportedLanguage | undefined
    return lang || DEFAULT_LANGUAGE
  })

  const dict = getTranslations(language)

  return function t(key: string, params?: Record<string, string | number>): string {
    let text = dict[key] ?? key // fallback to key itself (helps during development)

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      })
    }
    return text
  }
}

/**
 * Get current language code reactively.
 */
export function useCurrentLanguage(): SupportedLanguage {
  return useAppStore((state) => {
    const lang = state.settings?.language as SupportedLanguage | undefined
    return lang || DEFAULT_LANGUAGE
  }) as SupportedLanguage
}

/**
 * Non-hook version for one-off use (outside components).
 * Prefer the hook inside React components.
 */
export function getCurrentLanguage(): SupportedLanguage {
  // Access zustand store state directly (works outside components)
  const state = useAppStore.getState()
  const lang = state.settings?.language as SupportedLanguage | undefined
  return lang || DEFAULT_LANGUAGE
}

/**
 * Format a date/time using the current language locale.
 */
export function useFormatDateTime() {
  const language = useCurrentLanguage()

  return (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => {
    const d = date instanceof Date ? date : new Date(date)
    const locale = language === 'zh-CN' || language === 'zh-TW' ? 'zh-CN' : 'en-US'
    return d.toLocaleTimeString(locale, options)
  }
}
