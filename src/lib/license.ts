export const FREE_COPILOT_SECONDS = 10 * 60
export const SEASON_PASS_DAYS = 90
export const LICENSE_KIND = 'season-pass-90'
export const PAYWALL_ENABLED = false

export type LicenseStatus = 'free' | 'active' | 'expired' | 'invalid'

export interface LicensePayload {
  kind: typeof LICENSE_KIND
  licenseId: string
  expiresAt: string
  issuedAt: string
}

export interface LicenseState {
  status: LicenseStatus
  remainingFreeSeconds: number
  expiresAt: string | null
  licenseId: string | null
}

export function remainingFreeSeconds(usedSeconds: number, nowSeconds = usedSeconds): number {
  void nowSeconds
  return Math.max(0, FREE_COPILOT_SECONDS - Math.max(0, Math.floor(usedSeconds)))
}

export function parseLicensePayload(raw: string): LicensePayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LicensePayload>
    if (parsed.kind !== LICENSE_KIND) return null
    if (typeof parsed.licenseId !== 'string' || !parsed.licenseId.trim()) return null
    if (typeof parsed.expiresAt !== 'string' || Number.isNaN(Date.parse(parsed.expiresAt))) return null
    if (typeof parsed.issuedAt !== 'string' || Number.isNaN(Date.parse(parsed.issuedAt))) return null
    return {
      kind: LICENSE_KIND,
      licenseId: parsed.licenseId.trim(),
      expiresAt: parsed.expiresAt,
      issuedAt: parsed.issuedAt,
    }
  } catch {
    return null
  }
}

export function licenseStatus(payload: LicensePayload | null, now = new Date()): LicenseStatus {
  if (!payload) return 'invalid'
  return Date.parse(payload.expiresAt) > now.getTime() ? 'active' : 'expired'
}

export function deriveLicenseState(
  payload: LicensePayload | null,
  usedFreeSeconds: number,
  now = new Date(),
): LicenseState {
  const status = payload ? licenseStatus(payload, now) : 'free'
  return {
    status: status === 'invalid' ? 'free' : status,
    remainingFreeSeconds: remainingFreeSeconds(usedFreeSeconds),
    expiresAt: payload && status !== 'invalid' ? payload.expiresAt : null,
    licenseId: payload && status !== 'invalid' ? payload.licenseId : null,
  }
}

export function canGenerateSuggestion(state: LicenseState): boolean {
  // ponytail: paywall paused; toggle PAYWALL_ENABLED when re-enabling monetization
  if (!PAYWALL_ENABLED) return true
  return state.status === 'active' || state.remainingFreeSeconds > 0
}

export function shouldWarnPaywall(state: LicenseState): boolean {
  // ponytail: paywall paused; toggle PAYWALL_ENABLED when re-enabling monetization
  if (!PAYWALL_ENABLED) return false
  return state.status !== 'active' && state.remainingFreeSeconds > 0 && state.remainingFreeSeconds <= 120
}
