export interface ProtectionStatus {
  protection_requested: boolean
  protection_applied: boolean
  platform_supported: boolean
  request_dispatched: boolean
}

export function protectionMessageKey(status: ProtectionStatus | null): string {
  if (status && !status.platform_supported) return 'copilot.protection.unsupported'
  if (!status?.protection_requested) return 'copilot.protection.disabled'
  if (status.protection_applied) return 'copilot.protection.enabled'
  if (status.request_dispatched) return 'copilot.protection.unconfirmed'
  return 'copilot.protection.failed'
}
