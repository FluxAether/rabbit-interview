import Database from '@tauri-apps/plugin-sql';

let db: any = null;

export async function getDb() {
  if (!db) {
    db = await Database.load('sqlite:rabbitinterview.db');
    // Ensure tables
    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS interviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        role TEXT,
        company TEXT,
        score INTEGER,
        transcript TEXT,
        duration INTEGER,
        mode TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  return db;
}

export async function saveInterview(record: any): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `INSERT INTO interviews (date, role, company, score, transcript, duration, mode) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [record.date, record.role, record.company, record.score, record.transcript, record.duration, record.mode]
  );
  return result.lastInsertId as number;
}

export async function loadHistory(): Promise<any[]> {
  const database = await getDb();
  return await database.select(
    `SELECT id, date, role, company, score, transcript, duration, mode FROM interviews ORDER BY created_at DESC`
  );
}

export async function saveSetting(key: string, value: string) {
  const database = await getDb();
  await database.execute(
    `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
    [key, value]
  );
}

export async function loadSetting(key: string): Promise<string | null> {
  const database = await getDb();
  const rows = await database.select(`SELECT value FROM settings WHERE key = ?`, [key]);
  return rows.length > 0 ? rows[0].value : null;
}