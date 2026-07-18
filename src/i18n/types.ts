export type SupportedLanguage = 'en-US' | 'zh-CN' | 'zh-TW'

export interface LanguageOption {
  code: SupportedLanguage
  label: string
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en-US', label: 'English (United States)' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en-US'
