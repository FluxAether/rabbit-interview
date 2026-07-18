export type SupportedLanguage = 'en-US' | 'zh-CN' | 'zh-TW'

export interface LanguageOption {
  code: SupportedLanguage
  label: string
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en-US', label: 'English (United States)' },
]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN'
