#!/usr/bin/env node
/**
 * Migrate legacy plugin-store JSON into rabbitinterview.db.
 *
 * Default source (macOS):
 *   ~/Library/Application Support/com.rabbitinterview.desktop
 *
 * Usage:
 *   node scripts/migrate-json-to-db.mjs
 *   node scripts/migrate-json-to-db.mjs --app-data "/path/to/app-data"
 *   node scripts/migrate-json-to-db.mjs --force
 *   node scripts/migrate-json-to-db.mjs --keep-json
 *   node scripts/migrate-json-to-db.mjs --dry-run
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const APP_SETTINGS_KEY = 'app_settings'
const RESUME_WORKSPACE_KEY = 'resume_workspace'
const MIGRATION_FLAG_KEY = 'legacy_json_migrated_v1'
const SECRET_KEYS = [
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'DEEPGRAM_API_KEY',
]

const SECRET_PREFIX = 'ri1:'
const APP_SECRET_SEED = 'rabbit-interview/secrets/v1'

function parseArgs(argv) {
  const options = {
    appData: null,
    force: false,
    keepJson: false,
    dryRun: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--app-data' || arg === '--dir') {
      options.appData = argv[++i]
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--keep-json') {
      options.keepJson = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function printHelp() {
  console.log(`Migrate legacy JSON stores into rabbitinterview.db

Options:
  --app-data <dir>   App data directory (default: platform app data for com.rabbitinterview.desktop)
  --force            Overwrite existing DB values from JSON
  --keep-json        Do not rename migrated JSON files to *.migrated
  --dry-run          Show planned changes without writing
  --help             Show this help
`)
}

function defaultAppDataDir() {
  const home = os.homedir()
  const id = 'com.rabbitinterview.desktop'
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', id)
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    return path.join(appData, id)
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  return path.join(xdg, id)
}

function toI32(n) {
  return n | 0
}

function toU32(n) {
  return n >>> 0
}

function mathImul(a, b) {
  return Math.imul(toI32(a), toI32(b))
}

function deriveMask(length) {
  const mask = new Uint8Array(length)
  let state = 2166136261
  for (let i = 0; i < APP_SECRET_SEED.length; i += 1) {
    state = toI32(state ^ APP_SECRET_SEED.charCodeAt(i))
    state = mathImul(state, 16777619)
  }
  for (let i = 0; i < length; i += 1) {
    state = toI32(state ^ toI32(state << 13))
    state = toI32(state ^ toI32(state >>> 17))
    state = toI32(state ^ toI32(state << 5))
    mask[i] = state & 0xff
  }
  return mask
}

function encryptSecret(plain) {
  if (!plain) return ''
  const input = Buffer.from(String(plain), 'utf8')
  const mask = deriveMask(input.length)
  const out = Buffer.alloc(input.length)
  for (let i = 0; i < input.length; i += 1) out[i] = input[i] ^ mask[i]
  return `${SECRET_PREFIX}${out.toString('base64')}`
}

function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX)
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, value: null }
  const raw = fs.readFileSync(filePath, 'utf8')
  if (!raw.trim()) return { exists: true, value: null }
  try {
    return { exists: true, value: JSON.parse(raw) }
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${filePath}\n${error.message}`)
  }
}

function nowIso() {
  return new Date().toISOString()
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function loadBetterSqlite3() {
  const require = createRequire(import.meta.url)
  const candidates = [
    path.join(ROOT, 'node_modules', 'better-sqlite3'),
    'better-sqlite3',
  ]
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {
      // continue
    }
  }
  return null
}

function ensureSchemaWithSqlite3Cli(dbPath) {
  const schema = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`
  const result = spawnSync('sqlite3', [dbPath], {
    input: schema,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'sqlite3 schema setup failed')
  }

  const columns = spawnSync('sqlite3', [dbPath, 'PRAGMA table_info(settings);'], { encoding: 'utf8' })
  if (columns.status !== 0) {
    throw new Error(columns.stderr || 'failed to inspect settings table')
  }
  if (!columns.stdout.includes('|updated_at|') && !columns.stdout.split('\n').some((line) => line.includes('updated_at'))) {
    const alter = spawnSync('sqlite3', [dbPath, 'ALTER TABLE settings ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP;'], {
      encoding: 'utf8',
    })
    if (alter.status !== 0) {
      throw new Error(alter.stderr || 'failed to add settings.updated_at')
    }
  }
}

function queryScalarSqlite3(dbPath, sql) {
  const result = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `sqlite3 query failed: ${sql}`)
  }
  return result.stdout.replace(/\n$/, '')
}

function execSqlite3(dbPath, sql) {
  const result = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `sqlite3 exec failed: ${sql}`)
  }
}

function createDbAccess(dbPath) {
  const Database = loadBetterSqlite3()
  if (Database) {
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS secrets (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `)
    const settingsColumns = db.prepare('PRAGMA table_info(settings)').all()
    if (!settingsColumns.some((column) => column.name === 'updated_at')) {
      db.exec('ALTER TABLE settings ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP')
    }

    return {
      kind: 'better-sqlite3',
      getSetting(key) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
        return row?.value ?? null
      },
      setSetting(key, value) {
        db.prepare(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        ).run(key, value, nowIso())
      },
      getSecret(key) {
        const row = db.prepare('SELECT value FROM secrets WHERE key = ?').get(key)
        return row?.value ?? null
      },
      setSecret(key, value) {
        db.prepare(
          'INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        ).run(key, value, nowIso())
      },
      close() {
        db.close()
      },
    }
  }

  // Fallback: system sqlite3 CLI.
  const probe = spawnSync('sqlite3', ['-version'], { encoding: 'utf8' })
  if (probe.status !== 0) {
    throw new Error('Neither better-sqlite3 nor sqlite3 CLI is available')
  }
  ensureSchemaWithSqlite3Cli(dbPath)
  return {
    kind: 'sqlite3-cli',
    getSetting(key) {
      return queryScalarSqlite3(dbPath, `SELECT value FROM settings WHERE key = ${sqlQuote(key)};`) || null
    },
    setSetting(key, value) {
      execSqlite3(
        dbPath,
        `INSERT INTO settings (key, value, updated_at) VALUES (${sqlQuote(key)}, ${sqlQuote(value)}, ${sqlQuote(nowIso())}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
      )
    },
    getSecret(key) {
      return queryScalarSqlite3(dbPath, `SELECT value FROM secrets WHERE key = ${sqlQuote(key)};`) || null
    },
    setSecret(key, value) {
      execSqlite3(
        dbPath,
        `INSERT INTO secrets (key, value, updated_at) VALUES (${sqlQuote(key)}, ${sqlQuote(value)}, ${sqlQuote(nowIso())}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
      )
    },
    close() {},
  }
}

function archiveJson(filePath, keepJson, dryRun) {
  if (keepJson || !fs.existsSync(filePath)) return null
  const target = `${filePath}.migrated`
  if (dryRun) return target
  if (fs.existsSync(target)) {
    const stamped = `${filePath}.migrated.${Date.now()}`
    fs.renameSync(filePath, stamped)
    return stamped
  }
  fs.renameSync(filePath, target)
  return target
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const appData = path.resolve(options.appData || defaultAppDataDir())
  const dbPath = path.join(appData, 'rabbitinterview.db')
  const settingsPath = path.join(appData, 'app-settings.json')
  const keysPath = path.join(appData, 'keys.json')
  const resumePath = path.join(appData, 'resume-workspace.json')

  console.log(`App data: ${appData}`)
  console.log(`Database: ${dbPath}`)
  console.log(`Mode: ${options.dryRun ? 'dry-run' : 'write'}${options.force ? ' (force)' : ''}`)

  if (!fs.existsSync(appData)) {
    throw new Error(`App data directory does not exist: ${appData}`)
  }
  if (!fs.existsSync(dbPath)) {
    if (options.dryRun) {
      console.log('Database does not exist yet; would create on write run.')
    } else {
      fs.closeSync(fs.openSync(dbPath, 'a'))
    }
  }

  const settingsJson = readJsonIfExists(settingsPath)
  const keysJson = readJsonIfExists(keysPath)
  const resumeJson = readJsonIfExists(resumePath)

  const legacySettings = settingsJson.value && typeof settingsJson.value === 'object'
    ? settingsJson.value.settings ?? null
    : null
  const legacyResume = resumeJson.value && typeof resumeJson.value === 'object'
    ? resumeJson.value.workspace ?? null
    : null
  const legacyKeys = keysJson.value && typeof keysJson.value === 'object'
    ? keysJson.value
    : null

  const access = options.dryRun && !fs.existsSync(dbPath)
    ? {
        kind: 'dry-run-missing-db',
        getSetting() { return null },
        setSetting() {},
        getSecret() { return null },
        setSecret() {},
        close() {},
      }
    : createDbAccess(dbPath)

  const summary = {
    settings: 'skipped',
    resume: 'skipped',
    secrets: [],
    archived: [],
    backend: access.kind,
  }

  try {
    // Settings
    if (legacySettings != null) {
      const existing = access.getSetting(APP_SETTINGS_KEY)
      if (!existing || options.force) {
        const payload = JSON.stringify(legacySettings)
        if (!options.dryRun) access.setSetting(APP_SETTINGS_KEY, payload)
        summary.settings = existing && options.force ? 'overwritten' : 'migrated'
      } else {
        summary.settings = 'kept-existing'
      }
    } else {
      summary.settings = settingsJson.exists ? 'empty-or-invalid' : 'missing-json'
    }

    // Resume
    if (legacyResume != null) {
      const existing = access.getSetting(RESUME_WORKSPACE_KEY)
      if (!existing || options.force) {
        const payload = JSON.stringify(legacyResume)
        if (!options.dryRun) access.setSetting(RESUME_WORKSPACE_KEY, payload)
        summary.resume = existing && options.force ? 'overwritten' : 'migrated'
      } else {
        summary.resume = 'kept-existing'
      }
    } else {
      summary.resume = resumeJson.exists ? 'empty-or-invalid' : 'missing-json'
    }

    // Secrets
    for (const key of SECRET_KEYS) {
      const plain = legacyKeys && typeof legacyKeys[key] === 'string' ? legacyKeys[key].trim() : ''
      if (!plain) {
        summary.secrets.push({ key, status: legacyKeys ? 'missing-in-json' : 'missing-json' })
        continue
      }
      const existing = access.getSecret(key)
      if (existing && !options.force) {
        summary.secrets.push({ key, status: 'kept-existing', encrypted: isEncryptedSecret(existing) })
        continue
      }
      const encrypted = encryptSecret(plain)
      if (!options.dryRun) access.setSecret(key, encrypted)
      summary.secrets.push({
        key,
        status: existing && options.force ? 'overwritten' : 'migrated',
        encrypted: true,
      })
    }

    if (!options.dryRun) {
      access.setSetting(MIGRATION_FLAG_KEY, '1')
    }

    // Archive JSON after successful write.
    if (!options.dryRun) {
      for (const filePath of [settingsPath, keysPath, resumePath]) {
        if (!fs.existsSync(filePath)) continue
        const archived = archiveJson(filePath, options.keepJson, options.dryRun)
        if (archived) summary.archived.push(archived)
      }
    } else {
      for (const filePath of [settingsPath, keysPath, resumePath]) {
        if (fs.existsSync(filePath) && !options.keepJson) {
          summary.archived.push(`${filePath}.migrated`)
        }
      }
    }
  } finally {
    access.close()
  }

  console.log('\nMigration summary')
  console.log(`- backend: ${summary.backend}`)
  console.log(`- settings: ${summary.settings}`)
  console.log(`- resume: ${summary.resume}`)
  for (const item of summary.secrets) {
    console.log(`- secret ${item.key}: ${item.status}${item.encrypted ? ' (encrypted)' : ''}`)
  }
  if (summary.archived.length > 0) {
    console.log('- archived json:')
    for (const file of summary.archived) console.log(`  - ${file}`)
  } else if (options.keepJson) {
    console.log('- json files kept in place')
  }
  if (options.dryRun) {
    console.log('\nDry run only. Re-run without --dry-run to apply.')
  } else {
    console.log('\nDone. Next app launch will read from SQLite.')
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
