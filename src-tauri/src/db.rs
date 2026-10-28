use rusqlite::{params_from_iter, types::ValueRef, Connection};
use serde::Serialize;
use serde_json::{Number, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

pub struct DbState {
    conn: Mutex<Option<Connection>>,
    path: Mutex<String>,
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            conn: Mutex::new(None),
            path: Mutex::new(String::new()),
        }
    }
}

#[derive(Serialize)]
pub struct QueryBatch {
    columns: Vec<String>,
    values: Vec<Vec<Value>>,
}

fn lock_conn(state: &DbState) -> Result<std::sync::MutexGuard<'_, Option<Connection>>, String> {
    state.conn.lock().map_err(|e| e.to_string())
}

fn json_to_sql(value: &Value) -> rusqlite::types::Value {
    match value {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(flag) => rusqlite::types::Value::Integer(if *flag { 1 } else { 0 }),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                rusqlite::types::Value::Integer(integer)
            } else if let Some(real) = number.as_f64() {
                rusqlite::types::Value::Real(real)
            } else {
                rusqlite::types::Value::Text(number.to_string())
            }
        }
        Value::String(text) => rusqlite::types::Value::Text(text.clone()),
        other => rusqlite::types::Value::Text(other.to_string()),
    }
}

fn sql_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(integer) => Value::Number(integer.into()),
        ValueRef::Real(real) => Number::from_f64(real).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

fn db_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("skill-qa-agent.db"))
}

#[tauri::command]
pub fn db_open(app: AppHandle, state: State<DbState>) -> Result<String, String> {
    let mut guard = lock_conn(&state)?;
    if guard.is_some() {
        return state.path.lock().map(|path| path.clone()).map_err(|e| e.to_string());
    }

    let path = db_file(&app)?;
    let conn = Connection::open(&path).map_err(|error| error.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|error| error.to_string())?;

    let text = path.display().to_string();
    *guard = Some(conn);
    *state.path.lock().map_err(|e| e.to_string())? = text.clone();
    Ok(text)
}

#[tauri::command]
pub fn db_path(state: State<DbState>) -> Result<String, String> {
    let path = state.path.lock().map_err(|e| e.to_string())?;
    if path.is_empty() {
        return Err("数据库尚未打开".into());
    }
    Ok(path.clone())
}

#[tauri::command]
pub fn db_run(state: State<DbState>, sql: String, params: Vec<Value>) -> Result<(), String> {
    let guard = lock_conn(&state)?;
    let conn = guard.as_ref().ok_or("数据库尚未打开")?;
    if params.is_empty() {
        conn.execute_batch(&sql).map_err(|error| error.to_string())?;
        return Ok(());
    }
    let owned: Vec<rusqlite::types::Value> = params.iter().map(json_to_sql).collect();
    conn.execute(&sql, params_from_iter(owned.iter()))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_query(state: State<DbState>, sql: String) -> Result<Vec<QueryBatch>, String> {
    let guard = lock_conn(&state)?;
    let conn = guard.as_ref().ok_or("数据库尚未打开")?;
    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let count = statement.column_count();
    if count == 0 {
        return Ok(Vec::new());
    }
    let columns: Vec<String> = (0..count)
        .map(|index| statement.column_name(index).unwrap_or("").to_string())
        .collect();
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    let mut values = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let mut record = Vec::with_capacity(count);
        for index in 0..count {
            record.push(sql_to_json(row.get_ref(index).map_err(|error| error.to_string())?));
        }
        values.push(record);
    }
    Ok(vec![QueryBatch { columns, values }])
}
