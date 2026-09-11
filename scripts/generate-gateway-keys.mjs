import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export function generateKeys(targetDir, namePrefix = 'rabbit-oidc-') {
  fs.mkdirSync(targetDir, { recursive: true })

  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  const pemPath = path.resolve(targetDir, `${namePrefix}signing.pem`)
  const signingJsonPath = path.resolve(targetDir, `${namePrefix}signing.json`)
  const dataJsonPath = path.resolve(targetDir, `${namePrefix}data.json`)

  fs.writeFileSync(pemPath, privateKey, { mode: 0o600 })
  fs.writeFileSync(
    signingJsonPath,
    JSON.stringify(
      {
        active_kid: 'local-dev',
        keys: [
          {
            kid: 'local-dev',
            private_key_file: pemPath,
          },
        ],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )

  const dataKey = crypto.randomBytes(32).toString('base64url')
  fs.writeFileSync(
    dataJsonPath,
    JSON.stringify(
      {
        active_kid: 'local-dev',
        keys: {
          'local-dev': dataKey,
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )

  console.log(`Generated OIDC keys in ${targetDir}:`)
  console.log(`  - ${pemPath}`)
  console.log(`  - ${signingJsonPath}`)
  console.log(`  - ${dataJsonPath}`)

  return { pemPath, signingJsonPath, dataJsonPath }
}

// Generate in /tmp for standard local dev matching default server/.env
generateKeys('/tmp', 'rabbit-oidc-')

// Also generate/preserve in server/secrets for persistent backup
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const serverSecretsDir = path.resolve(projectRoot, 'server', 'secrets')
generateKeys(serverSecretsDir, '')
