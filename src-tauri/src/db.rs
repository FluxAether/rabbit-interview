use tauri::App;

pub fn init_db(_app: &App) -> Result<(), String> {
    // The sql plugin auto-creates the db file in app data dir when first query runs.
    // We register migrations here for tables.
    // Actual table creation will happen on first use via frontend or commands.

    // For now, just ensure plugin is ready. We will run CREATE TABLE via invoke.
    println!("SQLite plugin initialized. DB will be at app data dir.");
    Ok(())
}

