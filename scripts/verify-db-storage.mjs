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
