mod db;
mod secrets;

/// 桌面壳入口。课程数据走本机 SQLite 文件，API Key 走系统凭据管理器。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(db::DbState::default())
        .invoke_handler(tauri::generate_handler![
            db::db_open,
            db::db_path,
            db::db_run,
            db::db_query,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
