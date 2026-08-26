use keyring::Entry;
use tauri::command;

fn invalid_key(key: &str) -> bool {
    key.is_empty()
        || key.len() > 64
        || !key.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new("com.rabbitinterview.desktop", key).map_err(|error| error.to_string())
}

#[command]
pub fn load_secure_secret(key: String) -> Result<Option<String>, String> {
    if invalid_key(&key) {
        return Err("invalid secret key".into());
    }
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[command]
pub fn save_secure_secret(key: String, value: String) -> Result<(), String> {
    if invalid_key(&key) {
        return Err("invalid secret key".into());
    }
    entry(&key)?.set_password(&value).map_err(|error| error.to_string())
}

#[command]
pub fn delete_secure_secret(key: String) -> Result<(), String> {
    if invalid_key(&key) {
        return Err("invalid secret key".into());
    }
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
