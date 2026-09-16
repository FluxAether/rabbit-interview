import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import ts from 'typescript'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArrowUpRight, CheckCircle2, Loader2, LogOut, RefreshCw, UserRound, Wallet } from 'lucide-react'

function load(file, exports, dependencies = {}, extra = '') {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*$/gm, '').replace(/^export default /gm, '').replace(/^export /gm, '')
    .replaceAll('import.meta.env', '({ DEV: true })').replaceAll('import.meta', '({ env: { DEV: true } })')
  return new Function(...Object.keys(dependencies), `${js}\n${extra}\nreturn {${exports.join(',')}}`)(...Object.values(dependencies))
}
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const issuer = 'http://127.0.0.1:8787'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const accessToken = 'test-access-token'
const claims = { iss: issuer, sub: 'test-account', aud: 'oncue-desktop', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), at_hash: createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url') }
const tokenBody = [ { alg: 'RS256', kid: 'test' }, claims ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
const idToken = tokenBody + '.' + sign('RSA-SHA256', Buffer.from(tokenBody), privateKey).toString('base64url')
const secrets = new Map([['OPENAI_API_KEY', 'preserved-test-key']])
let entitlements = { account_id: 'test-account', status: 'ACTIVE', eligible: true, balances: { CREDITS: 0 }, credit_unit_scale: 60000, byok_unlocked: false, hosted_stt_enabled: true, hosted_llm_enabled: true }
let intercept = () => null
const requests = []
const auth = load('src/lib/hostedAuth.ts', ['initializeHostedAuth', 'refreshHostedEntitlements', 'getHostedAuthSnapshot', 'hasAppAccess', 'requireAppAccess', 'withAppAccessCheck', 'accountRequest', 'registerHostedConnection', 'signOutHosted', 'expire'], {
  window: { setTimeout, clearTimeout },
  invoke: async (name, { key, value }) => {
    if (name === 'load_secure_secret') return secrets.get(key) || null
    if (name === 'save_secure_secret') secrets.set(key, value)
    if (name === 'delete_secure_secret') secrets.delete(key)
  },
  loadSecret: async key => secrets.get(key) || null,
  saveSecret: async (key, value) => secrets.set(key, value), deleteSecret: async key => secrets.delete(key),
  decryptSecret: value => value, encryptSecret: value => value,
  listen: async () => () => {}, openUrl: async () => {},
  DEFAULT_LANGUAGE: 'en-US', useAppStore: { getState: () => ({ settings: {} }) },
  fetch: async (url, init) => {
    const path = new URL(url).pathname
    requests.push(path)
    const custom = intercept(path, init)
    if (custom) return custom
    if (path === '/.well-known/openid-configuration') return json({ issuer, code_challenge_methods_supported: ['S256'], ...Object.fromEntries(['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'revocation_endpoint', 'end_session_endpoint'].map(key => [key, `${issuer}/${key}`])) })
    if (path === '/token_endpoint') return json({ access_token: accessToken, id_token: idToken, refresh_token: 'rotated-test-refresh', expires_in: 300, token_type: 'Bearer' })
    if (path === '/jwks_uri') return json({ keys: [{ ...publicKey.export({ format: 'jwk' }), use: 'sig', kid: 'test' }] })
    if (path === '/v1/me/entitlements') return json(entitlements)
    if (path === '/revocation_endpoint') return json({})
    throw new Error(`Unexpected test request ${path}`)
  },
}, 'function expire() { accessTokenExpiresAt = 0 }')

// No stored login, an unavailable gateway, and invalid refresh credentials all fail closed.
await auth.initializeHostedAuth()
assert.equal(auth.getHostedAuthSnapshot().status, 'signed-out')
await assert.rejects(auth.requireAppAccess(), /Sign-in/)
secrets.set('HOSTED_REFRESH_TOKEN', 'test-refresh')
intercept = path => path === '/token_endpoint' ? Promise.reject(new TypeError('offline')) : null
await auth.initializeHostedAuth()
assert.equal(auth.getHostedAuthSnapshot().status, 'error')
assert(secrets.has('HOSTED_REFRESH_TOKEN'), 'transient network failure must keep the refresh token for retry')
intercept = () => null
await auth.initializeHostedAuth()
assert(auth.hasAppAccess(auth.getHostedAuthSnapshot()))
assert(requests.includes('/v1/me/entitlements'), 'startup validates entitlements online')
await auth.requireAppAccess()
await assert.rejects(auth.requireAppAccess(true), /BYOK/)

let upstreamCalls = 0, nativeCalls = 0, socketCloses = 0
class PendingSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 3
  readyState = 0
  constructor() { upstreamCalls++ }
  close() { this.readyState = 3; socketCloses++; this.onclose?.({}) }
}
const store = { getState: () => ({ settings: { aiAccessMode: 'byok', aiModel: 'gpt-4o-mini', sttProvider: 'deepgram' } }) }
const llm = load('src/lib/llm.ts', ['generateSuggestionsStream', 'generateStructuredJson', 'testDeepgramConnection', 'testGeminiLiveConnection', 'startDeepgramStream'], {
  ...auth, useAppStore: store, loadApiKeys: async () => ({ deepgram: 'test-key', gemini: 'test-key' }), getLlmApiKey: async () => 'test-key',
  fetch: async (_url, init) => { upstreamCalls++; init.signal.throwIfAborted(); return json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }) },
  WebSocket: PendingSocket,
})
for (const call of [() => llm.generateSuggestionsStream('q', '', { onDelta() {} }), () => llm.generateStructuredJson('s', 'p'), () => llm.testDeepgramConnection('test-key'), () => llm.testGeminiLiveConnection('test-key'), () => llm.startDeepgramStream(() => {})]) {
  await assert.rejects(call(), /BYOK/)
}
const keys = load('src/lib/keyStore.ts', ['setApiKey'], { ...auth, invoke: async () => { nativeCalls++ } })
await assert.rejects(keys.setApiKey('OPENAI_API_KEY', 'test-key'), /BYOK/)
const stt = load('src/lib/realtimeStt.ts', ['startRealtimeStt'], { ...auth, useAppStore: store, globalThis: { __TAURI_INTERNALS__: {} }, invoke: async () => { nativeCalls++ } })
await assert.rejects(stt.startRealtimeStt({ source: 'microphone', captureId: 1, sessionId: 1, sampleRate: 16000 }, {}), /BYOK/)
assert.equal(upstreamCalls + nativeCalls, 0, 'locked BYOK must not reach a provider, key store, or native STT')

// A purchased BYOK entitlement permits direct LLM use with zero hosted credits.
entitlements = { ...entitlements, byok_unlocked: true }
await auth.refreshHostedEntitlements()
assert.deepEqual(await llm.generateStructuredJson('system', 'prompt'), { ok: true })
assert.equal(upstreamCalls, 1)
assert.equal(auth.getHostedAuthSnapshot().entitlements.balances.CREDITS, 0)

// Logout cancels requests before waiting for network, and late balances cannot restore access.
const socketOpening = llm.testDeepgramConnection('test-key').catch(error => error)
await flush()
const request = auth.accountRequest(), late = deferred()
let closed = 0
const unregister = auth.registerHostedConnection(() => { closed++ })
intercept = path => path === '/v1/me/entitlements' ? late.promise : null
const refreshing = auth.refreshHostedEntitlements().catch(error => error)
await flush()
const logout = auth.signOutHosted()
assert.equal(auth.getHostedAuthSnapshot().status, 'signed-out')
await flush()
assert(request.signal.aborted)
assert.equal(closed, 1)
await assert.rejects(auth.refreshHostedEntitlements(), /Signed out/)
late.resolve(json(entitlements))
assert.equal((await refreshing).name, 'AbortError')
await logout
assert.match((await socketOpening).message, /closed before it was ready/)
assert.equal(socketCloses, 1, 'logout closes a pending BYOK connectivity check')
request.dispose(); unregister()
assert.equal(auth.getHostedAuthSnapshot().status, 'signed-out')
assert(!secrets.has('HOSTED_REFRESH_TOKEN'))
assert.equal(secrets.get('OPENAI_API_KEY'), 'preserved-test-key')

intercept = () => null
secrets.set('HOSTED_REFRESH_TOKEN', 'test-refresh')
await auth.initializeHostedAuth()
const invalidated = auth.accountRequest()
auth.expire()
intercept = path => path === '/token_endpoint' ? json({ error: 'invalid_grant' }, 400) : null
await assert.rejects(auth.requireAppAccess(true))
await flush()
assert(!auth.hasAppAccess(auth.getHostedAuthSnapshot()))
assert(invalidated.signal.aborted)
invalidated.dispose()

// Hosted LLM can pair with free Apple STT; legacy BYOK choices stay locked instead of switching.
const { deriveReadiness } = load('src/lib/readiness.ts', ['deriveReadiness'])
const base = { capabilities: { system_audio_available: true, microphone_available: true }, hosted: { authenticated: true, reachable: true, eligible: true, status: 'ACTIVE', creditUnits: 60000, byokUnlocked: false, sttEnabled: false, llmEnabled: true }, settings: { aiAccessMode: 'hosted', sttProvider: 'apple' }, appleSttAvailable: true }
assert.equal(deriveReadiness(base).sttProvider, 'apple')
assert(deriveReadiness(base).canStartCopilot)
const legacy = { ...base, settings: { aiAccessMode: 'byok', aiModel: 'gpt-4o-mini', sttProvider: 'apple' }, keys: { openai: true } }
assert(deriveReadiness(legacy).issues.some(issue => issue.code === 'byok-locked' && issue.settingsTab === 'account'))
assert(deriveReadiness({ ...legacy, hosted: { ...base.hosted, creditUnits: 0, byokUnlocked: true } }).canStartCopilot)
const settings = load('src/lib/settingsStore.ts', ['normalizeSettings', 'DEFAULT_SETTINGS'])
assert.equal(settings.DEFAULT_SETTINGS.aiAccessMode, 'hosted')
assert.equal(settings.normalizeSettings({ aiModel: 'gpt-4o-mini', sttProvider: 'deepgram' }).aiAccessMode, 'byok')
assert.equal(settings.normalizeSettings({ aiAccessMode: 'hosted', sttProvider: 'apple' }).sttProvider, 'apple')
console.log('Account access verification passed: online startup, retry, BYOK gates, zero-credit BYOK, logout races, credential invalidation, Apple STT, and legacy settings')

const { isPaymentProduct, FALLBACK_PRODUCTS } = load('landing/src/lib/catalog.ts', ['isPaymentProduct', 'FALLBACK_PRODUCTS'], {}, '')
assert(FALLBACK_PRODUCTS.every(isPaymentProduct))
assert(!isPaymentProduct({ code: 'PRO_MONTH', duration_days: 30 }))
assert(!isPaymentProduct({ ...FALLBACK_PRODUCTS[0], credit_units: -1 }))
assert(!isPaymentProduct({ ...FALLBACK_PRODUCTS.find(p => p.kind === 'BYOK'), credit_units: 60000 }))

// Account settings use live entitlements and keep a late profile from crossing accounts.
const { formatCreditsDisplay } = load('src/lib/credits.ts', ['formatCreditsDisplay'])
const { translations } = load('src/i18n/translations.ts', ['translations'])
let accountView = { status: 'signed-in', entitlements: { ...entitlements, balances: { CREDITS: 7_407_000 } }, error: null }
let hookIndex = 0, effect, profileResponse = deferred(), profileSignal
const hookState = []
const actions = []
const { AccountSettings } = load('src/components/AccountSettings.tsx', ['AccountSettings'], {
  React, ArrowUpRight, CheckCircle2, Loader2, LogOut, RefreshCw, UserRound, Wallet, formatCreditsDisplay, window: { setTimeout, clearTimeout },
  useCurrentLanguage: () => 'en-US',
  useTranslation: () => key => translations['en-US'][key] || key,
  useHostedAuth: () => accountView, hasAppAccess: auth.hasAppAccess,
  useState: initial => { const i = hookIndex++; if (!(i in hookState)) hookState[i] = initial; return [hookState[i], value => { hookState[i] = value }] },
  useEffect: callback => { effect = callback },
  hostedFetch: (_path, init) => { profileSignal = init.signal; return profileResponse.promise },
  ...Object.fromEntries(['initializeHostedAuth', 'openHostedSubscription', 'refreshHostedEntitlements', 'signInHosted', 'signOutHosted'].map(name => [name, async () => { actions.push(name) }])),
})
const renderAccount = () => { hookIndex = 0; return AccountSettings() }
const accountText = () => renderToStaticMarkup(renderAccount())
const nodes = element => React.isValidElement(element) ? [element, ...React.Children.toArray(element.props.children).flatMap(nodes)] : []
const clickAccount = label => {
  const button = nodes(renderAccount()).find(node => node.type === 'button' && renderToStaticMarkup(node).includes(label))
  assert(button && !button.props.disabled, `account action is enabled: ${label}`)
  button.props.onClick()
}
assert.match(accountText(), /123\.45/)
const cancelProfile = effect()
cancelProfile()
assert(profileSignal.aborted, 'leaving the account page cancels its profile request')
profileResponse.resolve(json({ sub: 'test-account', email: 'old@example.com', name: 'Old account' }))
await flush()
assert(!accountText().includes('old@example.com'), 'a late profile response must not be displayed')

profileResponse = deferred()
const completeProfile = effect()
profileResponse.resolve(json({ sub: 'test-account', email: 'member@example.com', name: 'Member' }))
await flush()
assert.match(accountText(), /member@example\.com/)
completeProfile()
clickAccount('Refresh balance')
assert(nodes(renderAccount()).filter(node => node.type === 'button').every(node => node.props.disabled), 'pending actions prevent duplicate account requests')
await flush()
clickAccount('Buy credits / Unlock BYOK'); await flush()
clickAccount('Sign out'); await flush()
assert.deepEqual(actions, ['refreshHostedEntitlements', 'openHostedSubscription', 'signOutHosted'])

profileResponse = deferred()
const invalidProfile = effect()
profileResponse.resolve(json({ sub: 'another-account', email: 'wrong@example.com' }))
await flush()
assert(!accountText().includes('wrong@example.com'), 'profile identity must match the signed-in account')
assert.match(accountText(), /Unable to load your email/)
invalidProfile()

accountView = { ...accountView, entitlements: { ...accountView.entitlements, balances: { CREDITS: 0 } } }
assert.match(accountText(), />0<\/span>/, 'zero balance remains a valid displayed balance')
accountView = { status: 'signed-out', entitlements: null, error: null }
assert(!accountText().includes('member@example.com'), 'signed-out state hides the previous profile')
assert(nodes(renderAccount()).filter(node => node.type === 'button' && /Refresh balance|Buy credits/.test(renderToStaticMarkup(node))).every(node => node.props.disabled))
clickAccount('Sign in / Register'); await flush()
assert.equal(actions.at(-1), 'signInHosted')
accountView = { status: 'restoring', entitlements: null, error: null }
assert(nodes(renderAccount()).filter(node => node.type === 'button').every(node => node.props.disabled))
accountView = { status: 'error', entitlements: null, error: 'Connection failed' }
assert.match(accountText(), /role="alert"[^>]*>Connection failed/)
clickAccount('Retry connection'); await flush()
assert.equal(actions.at(-1), 'initializeHostedAuth')
for (const dictionary of Object.values(translations)) {
  for (const key of Object.keys(translations['en-US']).filter(key => key.startsWith('settings.account.') || key.endsWith('.account'))) assert(dictionary[key], `${key} is translated`)
}
console.log('Account settings verification passed: profile cancellation, identity privacy, credit formatting, sign-in/out, refresh, subscription entry, retry, and translations')
