import type { SettingsTab } from './readiness'

export type Page = 'dashboard' | 'copilot' | 'mock' | 'resume' | 'history' | 'settings'
export type SettingsIntent = { tab: SettingsTab; returnTo?: Page }
