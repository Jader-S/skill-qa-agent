// Tauri v2 入口。MVP 阶段前端已自包含（localStorage 持久化 + 浏览器下载导出），
// 故后端暂无自定义命令。后续接入 SQLite / 写入 Obsidian vault / 语音 sidecar 时，
// 在此增加 invoke_handler 命令即可，无需改动前端结构（前端已通过 storage / export 适配器预留）。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
