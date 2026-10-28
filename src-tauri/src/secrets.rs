use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "skill-qa-agent";
const ACCOUNT: &str = "llm-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_get() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(secret: String) -> Result<(), String> {
    if secret.len() > 4096 {
        return Err("API Key 过长".into());
    }
    if secret.is_empty() {
        return secret_delete();
    }
    entry()?.set_password(&secret).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_roundtrip() {
        secret_set("probe-not-a-real-key".into()).expect("set");
        let got = secret_get().expect("get");
        assert_eq!(got.as_deref(), Some("probe-not-a-real-key"));
        secret_delete().expect("delete");
        assert_eq!(secret_get().expect("get after delete"), None);
    }
}
