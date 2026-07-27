mod models;
mod ai;
mod commands;
mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 结构化日志：默认 info 级，可用 RUST_LOG 环境变量调整（如 RUST_LOG=debug）。
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(true)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(db::init_db())
        .manage(commands::ai_commands::StreamAborts::default())
        .invoke_handler(tauri::generate_handler![
            commands::novel_commands::create_novel,
            commands::novel_commands::open_novel,
            commands::novel_commands::load_chapter_content,
            commands::novel_commands::save_novel,
            commands::novel_commands::delete_novel,
            commands::novel_commands::list_novels,
            commands::novel_commands::add_chapter,
            commands::novel_commands::delete_chapter,
            commands::novel_commands::reorder_chapters,
            commands::novel_commands::rename_chapter,
            commands::novel_commands::update_novel_metadata,
            commands::novel_commands::list_chapter_revisions,
            commands::novel_commands::get_chapter_revision,
            commands::novel_commands::restore_chapter_revision,
            commands::novel_commands::get_writing_stats,
            commands::novel_commands::list_characters,
            commands::novel_commands::create_character,
            commands::novel_commands::update_character,
            commands::novel_commands::delete_character,
            commands::novel_commands::list_character_relations,
            commands::novel_commands::upsert_character_relation,
            commands::novel_commands::delete_character_relation,
            commands::ai_commands::ai_chat,
            commands::ai_commands::ai_chat_stream,
            commands::ai_commands::ai_cancel_stream,
            commands::ai_commands::list_models,
            commands::ai_commands::test_connection,
            commands::export_commands::export_to_txt,
            commands::export_commands::export_to_markdown,
            commands::export_commands::export_to_epub,
            commands::secret_commands::secure_set_api_key,
            commands::secret_commands::secure_get_api_key,
            commands::secret_commands::secure_delete_api_key,
            commands::skill_commands::scan_local_skills,
            commands::skill_commands::list_skills,
            commands::skill_commands::enable_skill,
            commands::skill_commands::disable_skill,
            commands::skill_commands::uninstall_skill,
            commands::skill_commands::import_skill_from_dir,
            commands::skill_commands::import_skill_from_url,
            commands::skill_commands::import_skill_from_git,
            commands::skill_commands::run_skill_audit,
            commands::skill_commands::get_skill_audit_logs,
            commands::skill_commands::list_marketplace_skills,
            commands::skill_commands::get_active_skill_prompts,
            commands::skill_commands::get_default_skill_prompts,
            commands::skill_commands::get_skill_manifest,
            commands::skill_commands::update_skill_manifest,
            commands::skill_commands::execute_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
