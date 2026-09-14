export type LandingLang = 'zh' | 'en'
export type AuthLang = 'en' | 'zh-CN' | 'zh-TW'

export const LANG_KEY = 'oncue-lang'

function readRaw(): string | null {
  try {
    return localStorage.getItem(LANG_KEY)
      || localStorage.getItem('rabbit-auth-lang')
      || localStorage.getItem('rabbit-landing-lang')
  } catch {
    return null
  }
}

function writeRaw(value: string) {
  try {
    localStorage.setItem(LANG_KEY, value)
    localStorage.setItem('rabbit-auth-lang', value === 'zh' ? 'zh-CN' : value)
    localStorage.setItem('rabbit-landing-lang', value.startsWith('zh') ? 'zh' : 'en')
  } catch {
    // Language preference is optional.
  }
}

export function landingLangFromStore(): LandingLang {
  const raw = readRaw()
  if (raw?.toLowerCase().startsWith('en')) return 'en'
  if (raw) return 'zh'
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function writeLandingLang(lang: LandingLang) {
  writeRaw(lang === 'en' ? 'en' : 'zh-CN')
}

export function authLangFromStore(requested?: string | null, hideTraditional = false): AuthLang {
  const source = requested || readRaw()
  const value = (source || '').toLowerCase()
  if (!hideTraditional && (value === 'zh-tw' || value.startsWith('zh-tw') || value.startsWith('zh-hk') || value.startsWith('zh-hant'))) return 'zh-TW'
  if (value.startsWith('en')) return 'en'
  if (value === 'zh' || value === 'zh-cn' || value.startsWith('zh-cn') || value.startsWith('zh')) return 'zh-CN'
  const browser = navigator.language.toLowerCase()
  if (!hideTraditional && (browser.startsWith('zh-tw') || browser.startsWith('zh-hk') || browser.startsWith('zh-hant'))) return 'zh-TW'
  return browser.startsWith('zh') ? 'zh-CN' : 'en'
}

export function writeAuthLang(lang: AuthLang) {
  writeRaw(lang)
}
