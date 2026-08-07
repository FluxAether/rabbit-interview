import Database from "@tauri-apps/plugin-sql";
type SqlDatabase = {
  execute: (query: string, bindValues?: unknown[]) => Promise<{ rowsAffected?: number; lastInsertId?: number }>;
  select: <T = Record<string, unknown>>(query: string, bindValues?: unknown[]) => Promise<T[]>;
};

let db: SqlDatabase | null = null;
let dbPromise: Promise<SqlDatabase> | null = null;
let schemaReady: Promise<void> | null = null;
let migratedLegacyStores = false;

const APP_SETTINGS_KEY = "app_settings";
const RESUME_WORKSPACE_KEY = "resume_workspace";
const MIGRATION_FLAG_KEY = "legacy_json_migrated_v1";

export async function getDb(): Promise<SqlDatabase> {
  if (db) return db;
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    try {
      const instance = await Database.load("sqlite:rabbitinterview.db") as SqlDatabase;
      await ensureSchema(instance);
      db = instance;
      return instance;
    } catch (error) {
      db = null;
      dbPromise = null;
      schemaReady = null;
      throw error;
    }
  })();

  return dbPromise;
}

async function ensureSchema(instance: SqlDatabase): Promise<void> {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    await instance.execute(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    );
    const settingsColumns = await instance.select<{ name: string }>("PRAGMA table_info(settings)");
    if (!settingsColumns.some((column) => column.name === "updated_at")) {
      await instance.execute("ALTER TABLE settings ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP");
    }
    await instance.execute(
      "CREATE TABLE IF NOT EXISTS interviews (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, role TEXT, company TEXT, score INTEGER, transcript TEXT, duration INTEGER, mode TEXT, recording_path TEXT, details_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    );

    const interviewColumns = await instance.select<{ name: string }>("PRAGMA table_info(interviews)");
    if (!interviewColumns.some((column) => column.name === "recording_path")) {
      await instance.execute("ALTER TABLE interviews ADD COLUMN recording_path TEXT");
    }
    if (!interviewColumns.some((column) => column.name === "details_json")) {
      await instance.execute("ALTER TABLE interviews ADD COLUMN details_json TEXT");
    }

    await instance.execute(
      "CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    );
  })();

  return schemaReady;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function saveInterview(record: any): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    "INSERT INTO interviews (date, role, company, score, transcript, duration, mode, recording_path, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      record.date,
      record.role,
      record.company,
      record.score,
      record.transcript,
      record.duration,
      record.mode,
      record.recordingPath ?? null,
      record.detailsJson ?? null,
    ],
  );
  return result.lastInsertId as number;
}

export async function loadHistory(): Promise<any[]> {
  const database = await getDb();
  return await database.select(
    "SELECT id, date, role, company, score, transcript, duration, mode, recording_path AS recordingPath, details_json AS detailsJson FROM interviews ORDER BY created_at DESC",
  );
}

export type HistoryMode = "copilot" | "mock";

export interface HistoryPageOptions {
  page: number;
  pageSize: number;
  mode: HistoryMode;
  search?: string;
}

export interface HistoryPageResult {
  records: any[];
  total: number;
}

function historyWhereClause(mode: HistoryMode, search: string): { clause: string; values: unknown[] } {
  const modeClause = mode === "mock" ? "mode LIKE 'mock%'" : "LOWER(mode) = 'copilot'";
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return { clause: modeClause, values: [] };

  const pattern = `%${normalizedSearch}%`;
  return {
    clause: `${modeClause} AND (LOWER(COALESCE(role, '')) LIKE ? OR LOWER(COALESCE(company, '')) LIKE ?)`,
    values: [pattern, pattern],
  };
}

export async function loadHistoryPage(options: HistoryPageOptions): Promise<HistoryPageResult> {
  const database = await getDb();
  const page = Math.max(1, Math.floor(options.page));
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  const offset = (page - 1) * pageSize;
  const { clause, values } = historyWhereClause(options.mode, options.search ?? "");

  const [records, countRows] = await Promise.all([
    database.select(
      `SELECT id, date, role, company, score, transcript, duration, mode, recording_path AS recordingPath, details_json AS detailsJson FROM interviews WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset],
    ),
    database.select<{ total: number }>(
      `SELECT COUNT(*) AS total FROM interviews WHERE ${clause}`,
      values,
    ),
  ]);

  return {
    records,
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function loadHistoryCounts(): Promise<Record<HistoryMode, number>> {
  const database = await getDb();
  const rows = await database.select<{ mode: HistoryMode; total: number }>(
    "SELECT CASE WHEN LOWER(mode) = 'copilot' THEN 'copilot' ELSE 'mock' END AS mode, COUNT(*) AS total FROM interviews WHERE LOWER(mode) = 'copilot' OR mode LIKE 'mock%' GROUP BY CASE WHEN LOWER(mode) = 'copilot' THEN 'copilot' ELSE 'mock' END",
  );
  const counts: Record<HistoryMode, number> = { copilot: 0, mock: 0 };
  rows.forEach((row) => {
    counts[row.mode] = Number(row.total ?? 0);
  });
  return counts;
}

export async function saveSetting(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [key, value, nowIso()],
  );
}

export async function loadSetting(key: string): Promise<string | null> {
  const database = await getDb();
  const rows = await database.select<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return rows.length > 0 ? rows[0].value : null;
}

export async function deleteSetting(key: string): Promise<void> {
  const database = await getDb();
  await database.execute("DELETE FROM settings WHERE key = ?", [key]);
}

export async function saveAppSettingsJson(value: string): Promise<void> {
  await saveSetting(APP_SETTINGS_KEY, value);
}

export async function loadAppSettingsJson(): Promise<string | null> {
  return loadSetting(APP_SETTINGS_KEY);
}

export async function saveResumeWorkspaceJson(value: string): Promise<void> {
  await saveSetting(RESUME_WORKSPACE_KEY, value);
}

export async function loadResumeWorkspaceJson(): Promise<string | null> {
  return loadSetting(RESUME_WORKSPACE_KEY);
}

export async function clearResumeWorkspaceJson(): Promise<void> {
  await deleteSetting(RESUME_WORKSPACE_KEY);
}

export async function saveSecret(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    "INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [key, value, nowIso()],
  );
}

export async function loadSecret(key: string): Promise<string | null> {
  const database = await getDb();
  const rows = await database.select<{ value: string }>("SELECT value FROM secrets WHERE key = ?", [key]);
  return rows.length > 0 ? rows[0].value : null;
}

export async function deleteSecret(key: string): Promise<void> {
  const database = await getDb();
  await database.execute("DELETE FROM secrets WHERE key = ?", [key]);
}

export async function clearSecrets(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const database = await getDb();
  const placeholders = keys.map(() => "?").join(", ");
  await database.execute(`DELETE FROM secrets WHERE key IN (${placeholders})`, keys);
}

async function readLegacyStoreValue<T>(fileName: string, key: string): Promise<T | null> {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(fileName);
    const value = await store.get<T>(key);
    return value ?? null;
  } catch {
    return null;
  }
}

async function clearLegacyStoreKeys(fileName: string, keys: string[]): Promise<void> {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(fileName);
    for (const key of keys) {
      await store.delete(key);
    }
    await store.save();
  } catch {
    // Best-effort cleanup only.
  }
}

// One-shot import of pre-DB plugin-store JSON files into SQLite.
export async function migrateLegacyJsonStoresIfNeeded(
  encryptSecret: (plain: string) => string,
): Promise<void> {
  if (migratedLegacyStores) return;
  migratedLegacyStores = true;

  const alreadyMigrated = await loadSetting(MIGRATION_FLAG_KEY);
  if (alreadyMigrated === "1") return;

  const [existingSettings, existingResume] = await Promise.all([
    loadAppSettingsJson(),
    loadResumeWorkspaceJson(),
  ]);

  if (!existingSettings) {
    const legacySettings = await readLegacyStoreValue<unknown>("app-settings.json", "settings");
    if (legacySettings != null) {
      await saveAppSettingsJson(JSON.stringify(legacySettings));
      await clearLegacyStoreKeys("app-settings.json", ["settings"]);
    }
  }

  if (!existingResume) {
    const legacyResume = await readLegacyStoreValue<unknown>("resume-workspace.json", "workspace");
    if (legacyResume != null) {
      await saveResumeWorkspaceJson(JSON.stringify(legacyResume));
      await clearLegacyStoreKeys("resume-workspace.json", ["workspace"]);
    }
  }

  const legacyKeyNames = [
    "GROQ_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "DEEPGRAM_API_KEY",
  ] as const;

  const migratedKeyNames: string[] = [];
  for (const keyName of legacyKeyNames) {
    const existing = await loadSecret(keyName);
    if (existing) continue;
    const plain = await readLegacyStoreValue<string>("keys.json", keyName);
    if (!plain) continue;
    await saveSecret(keyName, encryptSecret(plain));
    migratedKeyNames.push(keyName);
  }
  if (migratedKeyNames.length > 0) {
    await clearLegacyStoreKeys("keys.json", migratedKeyNames);
  }

  await saveSetting(MIGRATION_FLAG_KEY, "1");
}

export async function clearAllLocalData(): Promise<void> {
  const database = await getDb();
  await database.execute('DELETE FROM interviews');
  await database.execute('DELETE FROM settings');
  await database.execute('DELETE FROM secrets');
}
