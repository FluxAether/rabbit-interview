import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'

export const THEME_KEY = 'oncue-theme'

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
    // Backwards compatibility with app settings if present
    const appStored = localStorage.getItem('theme')
    if (appStored === 'Light') return 'light'
    if (appStored === 'Dark') return 'dark'
  } catch {
    // Ignore localStorage access failures
  }
  return 'system'
}

export function writeTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Ignore localStorage access failures
  }
}

export function getResolvedTheme(theme: Theme = getStoredTheme()): 'light' | 'dark' {
  if (theme === 'system') return getSystemTheme()
  return theme
}

export function applyTheme(theme: Theme): 'light' | 'dark' {
  const resolved = getResolvedTheme(theme)
  const isDark = resolved === 'dark'
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', isDark)
    const meta = document.querySelector('meta[name="color-scheme"]')
    if (meta) {
      meta.setAttribute('content', isDark ? 'dark' : 'light')
    }
  }
  return resolved
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => getResolvedTheme(theme))

  useEffect(() => {
    const activeResolved = applyTheme(theme)
    setResolvedTheme(activeResolved)

    if (theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const listener = () => {
        const next = applyTheme('system')
        setResolvedTheme(next)
      }
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    }
  }, [theme])

  const setTheme = (next: Theme) => {
    setThemeState(next)
    writeTheme(next)
    applyTheme(next)
  }

  const toggleTheme = () => {
    // Direct toggle between light and dark
    const next = resolvedTheme === 'dark' ? 'light' : 'dark'
    setTheme(next)
  }

  return {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
  }
}
