import type { AppSettings, SttProvider } from './settingsStore'

export type SettingsTab = 'general' | 'ai' | 'stt' | 'shortcuts_privacy' | 'storage'
export type LlmProvider = 'groq' | 'openai' | 'anthropic' | 'gemini' | 'hosted'
export type ReadinessStatus = 'loading' | 'unconfigured' | 'testing' | 'ready' | 'degraded' | 'error'
export type ReadinessIssueCode =
  | 'missing-llm-key'
  | 'invalid-llm-key'
  | 'missing-stt-key'
  | 'invalid-stt-key'
  | 'apple-stt-unavailable'
  | 'microphone-unavailable'
  | 'microphone-denied'
  | 'system-audio-unavailable'
  | 'no-capture-source'
  | 'capabilities-unavailable'
  | 'hosted-auth-required'
  | 'hosted-not-eligible'
  | 'hosted-quota-insufficient'
  | 'hosted-unavailable'

export interface AudioCapabilitiesLike {
  system_audio_available: boolean
  microphone_available: boolean
  system_audio_reason: string | null
  microphone_reason: string | null
}

export interface ReadinessIssue {
  code: ReadinessIssueCode
  settingsTab: SettingsTab
  blocking: boolean
}

export interface ReadinessInput {
  settings?: Pick<AppSettings, 'aiModel' | 'aiAccessMode' | 'sttProvider'> | null
  keys?: Partial<Record<LlmProvider | 'deepgram', boolean>>
  hosted?: {
    authenticated: boolean
    reachable: boolean
    eligible: boolean
    status?: string
    sttUnits: number
    llmUnits: number
    sttEnabled: boolean
    llmEnabled: boolean
  } | null
  llmTest?: { success: boolean } | null
  sttTest?: { success: boolean } | null
  appleSttAvailable?: boolean
  capabilities?: AudioCapabilitiesLike | null
  capabilitiesError?: boolean
  microphonePermission?: 'unknown' | 'granted' | 'denied'
  useSystemAudio?: boolean
  useMicrophone?: boolean
  loading?: boolean
  testing?: boolean
}

export interface ReadinessState {
  status: ReadinessStatus
  llmProvider: LlmProvider
  sttProvider: SttProvider
  issues: ReadinessIssue[]
  canStartCopilot: boolean
}

export function resolveLlmProvider(aiModel?: string | null, accessMode?: string | null): LlmProvider {
  if (accessMode === 'hosted') return 'hosted'
  const configured = (aiModel || '').toLowerCase()
  if (configured.startsWith('gemini')) return 'gemini'
  if (configured.includes('claude')) return 'anthropic'
  if (configured.includes('gpt') || configured.startsWith('openai')) return 'openai'
  return 'groq'
}

export function sttRequiresCloudKey(provider: SttProvider): boolean {
  return provider === 'deepgram' || provider === 'gemini'
}

export function deriveReadiness(input: ReadinessInput): ReadinessState {
  const llmProvider = resolveLlmProvider(input.settings?.aiModel, input.settings?.aiAccessMode)
  const sttProvider = input.settings?.aiAccessMode === 'hosted' || input.settings?.sttProvider === 'hosted'
    ? 'hosted'
    : input.settings?.sttProvider === 'gemini' || input.settings?.sttProvider === 'apple'
      ? input.settings.sttProvider
      : 'deepgram'
  const issues: ReadinessIssue[] = []

  if (input.loading) {
    return {
      status: 'loading',
      llmProvider,
      sttProvider,
      issues,
      canStartCopilot: false,
    }
  }

  const hostedRequired = llmProvider === 'hosted' || sttProvider === 'hosted'
  if (hostedRequired) {
    if (input.hosted?.reachable === false) {
      issues.push({ code: 'hosted-unavailable', settingsTab: 'ai', blocking: true })
    } else if (!input.hosted?.authenticated) {
      issues.push({ code: 'hosted-auth-required', settingsTab: 'ai', blocking: true })
    } else if (!input.hosted.eligible || input.hosted.status !== 'ACTIVE') {
      issues.push({ code: 'hosted-not-eligible', settingsTab: 'ai', blocking: true })
    }
  }

  if (llmProvider === 'hosted') {
    if (input.hosted?.authenticated && (!input.hosted.llmEnabled || input.hosted.llmUnits <= 0)) {
      issues.push({ code: 'hosted-quota-insufficient', settingsTab: 'ai', blocking: true })
    }
  } else {
    const llmConfigured = Boolean(input.keys?.[llmProvider])
    if (!llmConfigured) {
      issues.push({ code: 'missing-llm-key', settingsTab: 'ai', blocking: true })
    } else if (input.llmTest && input.llmTest.success === false) {
      issues.push({ code: 'invalid-llm-key', settingsTab: 'ai', blocking: true })
    }
  }

  if (sttProvider === 'hosted') {
    if (input.hosted?.authenticated && (!input.hosted.sttEnabled || input.hosted.sttUnits <= 0)) {
      issues.push({ code: 'hosted-quota-insufficient', settingsTab: 'stt', blocking: true })
    }
  } else if (sttProvider === 'apple') {
    if (input.appleSttAvailable === false) {
      issues.push({ code: 'apple-stt-unavailable', settingsTab: 'stt', blocking: true })
    }
  } else {
    const sttKeyName = sttProvider === 'gemini' ? 'gemini' : 'deepgram'
    if (!input.keys?.[sttKeyName]) {
      issues.push({ code: 'missing-stt-key', settingsTab: 'stt', blocking: true })
    } else if (input.sttTest && input.sttTest.success === false) {
      issues.push({ code: 'invalid-stt-key', settingsTab: 'stt', blocking: true })
    }
  }

  if (input.capabilitiesError || !input.capabilities) {
    issues.push({ code: 'capabilities-unavailable', settingsTab: 'shortcuts_privacy', blocking: true })
  } else {
    const useSystemAudio = input.useSystemAudio ?? true
    const useMicrophone = input.useMicrophone ?? false
    if (useSystemAudio && !input.capabilities.system_audio_available) {
      issues.push({ code: 'system-audio-unavailable', settingsTab: 'shortcuts_privacy', blocking: !useMicrophone })
    }
    if (useMicrophone && !input.capabilities.microphone_available) {
      issues.push({ code: 'microphone-unavailable', settingsTab: 'shortcuts_privacy', blocking: true })
    }
    if (useMicrophone && input.microphonePermission === 'denied') {
      issues.push({ code: 'microphone-denied', settingsTab: 'shortcuts_privacy', blocking: true })
    }
    if (!useSystemAudio && !useMicrophone) {
      issues.push({ code: 'no-capture-source', settingsTab: 'shortcuts_privacy', blocking: true })
    }
  }

  const blocking = issues.filter((issue) => issue.blocking)
  const unconfigured = blocking.some((issue) => issue.code.startsWith('missing-') || issue.code === 'apple-stt-unavailable' || issue.code === 'hosted-auth-required' || issue.code === 'hosted-not-eligible' || issue.code === 'hosted-quota-insufficient')
  let status: ReadinessStatus
  if (input.testing) status = 'testing'
  else if (blocking.length > 0) status = unconfigured ? 'unconfigured' : 'error'
  else if (issues.length > 0) status = 'degraded'
  else status = 'ready'

  return {
    status,
    llmProvider,
    sttProvider,
    issues,
    canStartCopilot: status === 'ready' || status === 'degraded',
  }
}

export function primarySettingsTab(state: ReadinessState): SettingsTab {
  return state.issues.find((issue) => issue.blocking)?.settingsTab
    ?? state.issues[0]?.settingsTab
    ?? 'ai'
}
