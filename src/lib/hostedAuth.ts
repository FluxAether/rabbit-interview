import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useSyncExternalStore } from 'react'
import { DEFAULT_LANGUAGE } from '../i18n/types'
import { useAppStore } from '../stores/useAppStore'

const REFRESH_TOKEN_KEY = 'HOSTED_REFRESH_TOKEN'
const OIDC_CLIENT_ID = 'rabbit-desktop'
const OIDC_REDIRECT_URI = 'rabbitinterview://auth/callback'
const OIDC_POST_LOGOUT_REDIRECT_URI = 'rabbitinterview://auth/logout'
const OIDC_SCOPES = 'openid profile email offline_access'

export interface HostedEntitlements {
  account_id: string
  eligible: boolean
  status: string
  balances: Record<'STT_AUDIO_MS' | 'LLM_TOKEN_UNITS', number>
  hosted_stt_enabled: boolean
  hosted_llm_enabled: boolean
  payments_enabled: boolean
}

export interface HostedAuthSnapshot {
  status: 'signed-out' | 'restoring' | 'signed-in' | 'error'
  entitlements: HostedEntitlements | null
  error: string | null
}

interface OidcDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  revocation_endpoint: string
  end_session_endpoint: string
  code_challenge_methods_supported: string[]
}

interface OidcJwk extends JsonWebKey {
  kid?: string
  alg?: string
  use?: string
}

interface TokenResponse {
  access_token: string
  id_token: string
  refresh_token?: string | null
  expires_in: number
  token_type: string
  scope: string
}

interface PendingLogin {
  state: string
  nonce: string
  verifier: string
  discovery: OidcDiscovery
  resolve: () => void
  reject: (error: Error) => void
  timeout: number
}

interface IdTokenClaims {
  iss?: string
  sub?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  nonce?: string
  at_hash?: string
}

let snapshot: HostedAuthSnapshot = { status: 'signed-out', entitlements: null, error: null }
let accessToken = ''
let idToken = ''
let accessTokenExpiresAt = 0
let refreshPromise: Promise<boolean> | null = null
let initialization: Promise<void> | null = null
let callbackListener: Promise<() => void> | null = null
let pendingLogin: PendingLogin | null = null
let pendingLogoutState = ''
let discoveryPromise: Promise<OidcDiscovery> | null = null
const subscribers = new Set<() => void>()
const activeConnections = new Set<() => void>()

function gatewayBase(): string {
  const configured = String(import.meta.env.VITE_HOSTED_GATEWAY_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8787' : '')).trim()
  if (!configured) throw new Error('Hosted gateway is not configured for this build.')
  const url = new URL(configured)
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Hosted gateway must use HTTPS outside localhost.')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Hosted gateway must be configured as an origin without credentials or a path.')
  }
  return url.origin
}

async function getDiscovery(): Promise<OidcDiscovery> {
  if (discoveryPromise) return discoveryPromise
  discoveryPromise = (async () => {
    const base = gatewayBase()
    const response = await fetch(`${base}/.well-known/openid-configuration`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to load hosted sign-in configuration.')
    const discovery = await response.json() as OidcDiscovery
    if (discovery.issuer !== base || !discovery.code_challenge_methods_supported?.includes('S256')) {
      throw new Error('Hosted sign-in configuration is invalid.')
    }
    for (const endpoint of [
      discovery.authorization_endpoint,
      discovery.token_endpoint,
      discovery.jwks_uri,
      discovery.revocation_endpoint,
      discovery.end_session_endpoint,
    ]) {
      const url = new URL(endpoint)
      if (url.origin !== base || url.username || url.password || url.search || url.hash) {
        throw new Error('Hosted sign-in configuration contains an untrusted endpoint.')
      }
    }
    return discovery
  })().catch((error) => {
    discoveryPromise = null
    throw error
  })
  return discoveryPromise
}

function publish(next: HostedAuthSnapshot) {
  snapshot = next
  subscribers.forEach((subscriber) => subscriber())
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

export function getHostedAuthSnapshot(): HostedAuthSnapshot {
  return snapshot
}

export function useHostedAuth(): HostedAuthSnapshot {
  return useSyncExternalStore(subscribe, getHostedAuthSnapshot, getHostedAuthSnapshot)
}

export function initializeHostedAuth(): Promise<void> {
  if (initialization) return initialization
  initialization = (async () => {
    await ensureCallbackListener()
    publish({ status: 'restoring', entitlements: null, error: null })
    const restored = await refreshAccessToken()
    if (!restored) {
      publish({ status: 'signed-out', entitlements: null, error: null })
      return
    }
    await refreshHostedEntitlements()
  })().catch((error) => {
    publish({ status: 'error', entitlements: null, error: normalizeError(error) })
  })
  return initialization
}

export async function signInHosted(): Promise<void> {
  await ensureCallbackListener()
  if (pendingLogin) throw new Error('A sign-in attempt is already active.')
  const discovery = await getDiscovery()
  const state = randomBase64Url(32)
  const nonce = randomBase64Url(32)
  const verifier = randomBase64Url(64)
  const challenge = await sha256Base64Url(verifier)
  const authorize = new URL(discovery.authorization_endpoint)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('client_id', OIDC_CLIENT_ID)
  authorize.searchParams.set('redirect_uri', OIDC_REDIRECT_URI)
  authorize.searchParams.set('scope', OIDC_SCOPES)
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('nonce', nonce)
  authorize.searchParams.set('code_challenge', challenge)
  authorize.searchParams.set('code_challenge_method', 'S256')
  authorize.searchParams.set(
    'ui_locales',
    useAppStore.getState().settings.language || DEFAULT_LANGUAGE,
  )
  publish({ ...snapshot, status: 'restoring', error: null })

  const completion = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (pendingLogin?.state !== state) return
      pendingLogin = null
      publish({ status: 'signed-out', entitlements: null, error: 'Sign-in timed out.' })
      reject(new Error('Sign-in timed out.'))
    }, 5 * 60_000)
    pendingLogin = { state, nonce, verifier, discovery, resolve, reject, timeout }
  })
  try {
    await openUrl(authorize.toString())
  } catch (error) {
    const pending = pendingLogin as PendingLogin | null
    pendingLogin = null
    if (pending) window.clearTimeout(pending.timeout)
    publish({ status: 'signed-out', entitlements: null, error: normalizeError(error) })
    throw error
  }
  return completion
}

export async function signOutHosted(): Promise<void> {
  activeConnections.forEach((close) => close())
  activeConnections.clear()
  const refreshToken = await invoke<string | null>('load_secure_secret', { key: REFRESH_TOKEN_KEY }).catch(() => null)
  const logoutIdToken = idToken
  const discovery = await getDiscovery().catch(() => null)
  if (refreshToken && discovery) {
    await fetch(discovery.revocation_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ token: refreshToken, token_type_hint: 'refresh_token', client_id: OIDC_CLIENT_ID }),
    }).catch(() => {})
  }
  accessToken = ''
  idToken = ''
  accessTokenExpiresAt = 0
  await invoke('delete_secure_secret', { key: REFRESH_TOKEN_KEY }).catch(() => {})
  publish({ status: 'signed-out', entitlements: null, error: null })
  if (discovery && logoutIdToken) {
    pendingLogoutState = randomBase64Url(32)
    const logout = new URL(discovery.end_session_endpoint)
    logout.searchParams.set('id_token_hint', logoutIdToken)
    logout.searchParams.set('post_logout_redirect_uri', OIDC_POST_LOGOUT_REDIRECT_URI)
    logout.searchParams.set('state', pendingLogoutState)
    await openUrl(logout.toString()).catch(() => {})
  }
}

export function registerHostedConnection(close: () => void): () => void {
  activeConnections.add(close)
  return () => activeConnections.delete(close)
}

export async function hostedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!accessToken || accessTokenExpiresAt <= Date.now() + 30_000) {
    if (!(await refreshAccessToken())) throw new Error('Hosted sign-in is required.')
  }
  const request = () => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    return fetch(new URL(path, `${gatewayBase()}/`), { ...init, headers })
  }
  let response = await request()
  if (response.status === 401 && await refreshAccessToken(true)) response = await request()
  return response
}

export async function refreshHostedEntitlements(): Promise<HostedEntitlements> {
  try {
    const response = await hostedFetch('/v1/me/entitlements', { cache: 'no-store' })
    if (!response.ok) throw new Error(await safeError(response, 'Unable to load hosted quota.'))
    const entitlements = await response.json() as HostedEntitlements
    publish({ status: 'signed-in', entitlements, error: null })
    return entitlements
  } catch (error) {
    publish({ status: 'error', entitlements: snapshot.entitlements, error: normalizeError(error) })
    throw error
  }
}

async function ensureCallbackListener(): Promise<void> {
  if (!callbackListener) {
    callbackListener = listen<string>('auth-callback', (event) => {
      void handleCallback(event.payload)
    })
  }
  await callbackListener
}

async function handleCallback(rawUrl: string) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'rabbitinterview:' || url.hostname !== 'auth') return
  if (url.pathname === '/logout') {
    if (pendingLogoutState && url.searchParams.get('state') === pendingLogoutState) pendingLogoutState = ''
    return
  }
  const pending = pendingLogin
  if (!pending || url.pathname !== '/callback') return
  try {
    if (url.searchParams.get('state') !== pending.state) throw new Error('Sign-in state did not match.')
    if (url.searchParams.get('iss') !== pending.discovery.issuer) throw new Error('Sign-in issuer did not match.')
    const providerError = url.searchParams.get('error')
    if (providerError) throw new Error(`Sign-in failed: ${providerError}`)
    const code = url.searchParams.get('code')
    if (!code) throw new Error('Sign-in callback did not include a code.')
    const response = await fetch(pending.discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        grant_type: 'authorization_code',
        client_id: OIDC_CLIENT_ID,
        code,
        code_verifier: pending.verifier,
        redirect_uri: OIDC_REDIRECT_URI,
      }),
    })
    if (!response.ok) throw new Error(await safeError(response, 'Unable to complete sign-in.'))
    await applyToken(await response.json() as TokenResponse, pending.discovery, pending.nonce)
    await refreshHostedEntitlements()
    pending.resolve()
  } catch (error) {
    publish({ status: 'error', entitlements: null, error: normalizeError(error) })
    pending.reject(error instanceof Error ? error : new Error(String(error)))
  } finally {
    window.clearTimeout(pending.timeout)
    if (pendingLogin === pending) pendingLogin = null
  }
}

async function refreshAccessToken(force = false): Promise<boolean> {
  if (!force && accessToken && accessTokenExpiresAt > Date.now() + 30_000) return true
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const refreshToken = await invoke<string | null>('load_secure_secret', { key: REFRESH_TOKEN_KEY }).catch(() => null)
    if (!refreshToken) return false
    const discovery = await getDiscovery()
    const response = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ grant_type: 'refresh_token', client_id: OIDC_CLIENT_ID, refresh_token: refreshToken }),
    })
    if (!response.ok) {
      await clearLocalTokens()
      return false
    }
    await applyToken(await response.json() as TokenResponse, discovery)
    return true
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

async function applyToken(token: TokenResponse, discovery: OidcDiscovery, expectedNonce?: string) {
  if (!token.access_token || !token.id_token || token.token_type.toLowerCase() !== 'bearer') {
    throw new Error('Hosted authentication returned an invalid token response.')
  }
  await validateIdToken(token.id_token, token.access_token, discovery, expectedNonce)
  if (token.refresh_token) {
    await invoke('save_secure_secret', { key: REFRESH_TOKEN_KEY, value: token.refresh_token })
  }
  accessToken = token.access_token
  idToken = token.id_token
  accessTokenExpiresAt = Date.now() + Math.max(30, token.expires_in || 300) * 1000
}

async function validateIdToken(idTokenValue: string, accessTokenValue: string, discovery: OidcDiscovery, expectedNonce?: string) {
  const parts = idTokenValue.split('.')
  if (parts.length !== 3) throw new Error('Hosted authentication returned a malformed ID token.')
  const header = JSON.parse(base64UrlText(parts[0])) as { alg?: string; kid?: string }
  const claims = JSON.parse(base64UrlText(parts[1])) as IdTokenClaims
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Hosted authentication used an unsupported ID token signature.')
  const jwksResponse = await fetch(discovery.jwks_uri, { cache: 'no-store' })
  if (!jwksResponse.ok) throw new Error('Unable to load hosted signing keys.')
  const jwks = await jwksResponse.json() as { keys?: OidcJwk[] }
  const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig')
  if (!jwk) throw new Error('Hosted authentication signing key was not found.')
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  )
  const now = Math.floor(Date.now() / 1000)
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!valid
    || claims.iss !== discovery.issuer
    || !audience.includes(OIDC_CLIENT_ID)
    || typeof claims.sub !== 'string'
    || typeof claims.exp !== 'number'
    || claims.exp < now - 60
    || typeof claims.iat !== 'number'
    || claims.iat > now + 60
    || (expectedNonce !== undefined && claims.nonce !== expectedNonce)
    || claims.at_hash !== await accessTokenHash(accessTokenValue)) {
    throw new Error('Hosted authentication ID token validation failed.')
  }
}

async function clearLocalTokens() {
  accessToken = ''
  idToken = ''
  accessTokenExpiresAt = 0
  await invoke('delete_secure_secret', { key: REFRESH_TOKEN_KEY }).catch(() => {})
}

function formBody(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values)
}

function randomBase64Url(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function sha256Base64Url(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

async function accessTokenHash(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return base64Url(digest.slice(0, digest.length / 2))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function base64UrlText(value: string): string {
  return new TextDecoder().decode(base64UrlBytes(value))
}

async function safeError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: string; error?: string; error_description?: string } | null
  return body?.message || body?.error_description || body?.error || fallback
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
