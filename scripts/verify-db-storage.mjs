import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

// Strip TS type annotations enough for a tiny pure helper evaluation.
const secretSource = read('src/lib/secretCrypto.ts')
  .replace(/: [A-Za-z0-9_<>|&\[\]\s]+(?=[,)=])/g, '')
  .replace(/\)\s*:\s*[A-Za-z0-9_<>|&\[\]\s]+(?=\s*\{)/g, ')')
  .replace(/^export /gm, '')
  .concat('\n;({ encryptSecret, decryptSecret, isEncryptedSecret })')

const { encryptSecret, decryptSecret, isEncryptedSecret } = vm.runInNewContext(secretSource, {
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  TextEncoder,
  TextDecoder,
})

const plain = 'sk-test-1234567890'
const encrypted = encryptSecret(plain)
assert.notEqual(encrypted, plain, 'secret is not stored as plaintext')
assert.equal(isEncryptedSecret(encrypted), true, 'encrypted secrets use the ri1 prefix')
assert.equal(decryptSecret(encrypted), plain, 'encrypted secrets round-trip')
assert.equal(decryptSecret(plain), plain, 'legacy plaintext secrets still load')
assert.equal(encryptSecret('abc'), encryptSecret('abc'), 'encryption is deterministic for migration stability')

const dbSource = read('src/lib/db.ts')
assert.match(dbSource, /CREATE TABLE IF NOT EXISTS secrets/, 'db creates secrets table')
assert.match(dbSource, /app_settings/, 'settings JSON lives under app_settings key')
assert.match(dbSource, /resume_workspace/, 'resume JSON lives under resume_workspace key')
assert.match(dbSource, /migrateLegacyJsonStoresIfNeeded/, 'legacy JSON migration exists')
assert.match(dbSource, /encryptSecret/, 'legacy key migration encrypts secrets')
assert.match(dbSource, /loadHistoryStorageUsage/, 'history storage usage helper exists')
assert.match(dbSource, /length\(CAST\(transcript AS BLOB\)\)/, 'history usage counts UTF-8 field bytes')
assert.match(dbSource, /clearInterviewHistory[\s\S]*DELETE FROM interviews/, 'history can be cleared independently')
assert.match(dbSource, /clearInterviewRecordingPaths[\s\S]*UPDATE interviews SET recording_path = NULL/, 'recording paths can be cleared without deleting history')

const audioSource = read('src-tauri/src/audio/mod.rs')
const rustLibSource = read('src-tauri/src/lib.rs')
assert.match(audioSource, /get_recording_storage_usage/, 'native recording usage command exists')
assert.match(audioSource, /clear_audio_recordings/, 'native recording cleanup command exists')
assert.match(audioSource, /starts_with\("interview-"\).*ends_with\("\.wav"\)/s, 'recording cleanup targets app WAV files')
assert.match(audioSource, /recording-active/, 'active recordings are protected')
assert.match(audioSource, /capture_thread_active/, 'native cleanup checks the capture thread as well as the mode')
assert.match(rustLibSource, /get_recording_storage_usage[\s\S]*clear_audio_recordings/, 'recording storage commands are registered')

const settingsPage = read('src/pages/Settings.tsx')
assert.match(settingsPage, /activeTab === 'storage'/, 'settings includes the storage submenu')
assert.match(settingsPage, /invoke<RecordingStorageUsage>\('clear_audio_recordings'\)[\s\S]*clearInterviewRecordingPaths\(\)/, 'recording cleanup also removes stale history paths')
assert.match(settingsPage, /copilot\.phase === 'stopping'/, 'recording cleanup waits for Copilot archival to finish')
assert.match(settingsPage, /clearInterviewHistory\(\)[\s\S]*loadHistory\(\[\]\)/, 'history cleanup refreshes global history state')
assert.match(settingsPage, /function formatStorageBytes/, 'storage sizes use a shared formatter')
assert.doesNotMatch(settingsPage.match(/const handleClearLocalData[\s\S]*?\n  }/)?.[0] ?? '', /clear_audio_recordings/, 'existing full local-data cleanup scope is unchanged')

const formatterSource = settingsPage
  .match(/function formatStorageBytes\(bytes: number\): string \{[\s\S]*?\n\}/)?.[0]
  ?.replace('(bytes: number): string', '(bytes)')
assert.ok(formatterSource, 'storage size formatter can be evaluated')
const formatStorageBytes = vm.runInNewContext(`${formatterSource}\nformatStorageBytes`)
assert.equal(formatStorageBytes(0), '0 B', 'storage formatter handles bytes')
assert.equal(formatStorageBytes(1536), '1.5 KB', 'storage formatter keeps one useful decimal')
assert.equal(formatStorageBytes(1024 ** 3), '1 GB', 'storage formatter reaches gigabytes')

const translationsSource = read('src/i18n/translations.ts')
assert.equal(translationsSource.match(/'settings\.tab\.storage'/g)?.length, 3, 'storage tab is translated in all supported languages')
assert.equal(translationsSource.match(/'settings\.storage\.recordingActive'/g)?.length, 3, 'active recording errors are translated in all supported languages')

const settingsSource = read('src/lib/settingsStore.ts')
assert.doesNotMatch(settingsSource, /plugin-store/, 'settings store no longer uses plugin-store')
assert.match(settingsSource, /loadAppSettingsJson|saveAppSettingsJson/, 'settings store uses db helpers')

const keySource = read('src/lib/keyStore.ts')
assert.doesNotMatch(keySource, /plugin-store/, 'key store no longer uses plugin-store')
assert.match(keySource, /encryptSecret/, 'key store encrypts secrets')
assert.match(keySource, /decryptSecret/, 'key store decrypts secrets')

const resumeSource = read('src/lib/resumeWorkspaceStore.ts')
assert.doesNotMatch(resumeSource, /plugin-store/, 'resume store no longer uses plugin-store')
assert.match(resumeSource, /saveResumeWorkspaceJson|loadResumeWorkspaceJson/, 'resume store uses db helpers')

console.log('DB storage verification passed')
