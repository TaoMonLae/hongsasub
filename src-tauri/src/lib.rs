mod commands;
mod fonts;
mod media;
mod server;

use std::sync::Mutex;

use hongsasub_core::{Dictionary, SpellChecker, TranslationMemory};
use tauri::path::BaseDirectory;
use tauri::Manager;

pub struct AppState {
    pub tm: Mutex<TranslationMemory>,
}

pub struct SpellState {
    pub checker: Mutex<Option<SpellChecker>>,
}

pub struct DictState {
    pub dict: Mutex<Option<Dictionary>>,
    pub error: Option<String>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let tm = TranslationMemory::open(dir.join("memory.sqlite"))
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            app.manage(AppState { tm: Mutex::new(tm) });
            app.manage(server::MediaServer::start()?);
            let opened = app
                .path()
                .resolve("mondict.sqlite", BaseDirectory::Resource)
                .map_err(|e| e.to_string())
                .and_then(|p| Dictionary::open(p).map_err(|e| e.to_string()));
            app.manage(SpellState { checker: Mutex::new(None) });
            app.manage(match opened {
                Ok(dict) => DictState { dict: Mutex::new(Some(dict)), error: None },
                Err(e) => DictState { dict: Mutex::new(None), error: Some(e) },
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_subtitle,
            commands::open_project,
            commands::save_project,
            commands::export_subtitle,
            commands::tm_suggest,
            commands::tm_commit,
            commands::tm_pretranslate,
            commands::tm_delete,
            commands::tm_concordance,
            commands::tm_stats,
            commands::tm_import_pair,
            commands::tm_preview_pair,
            commands::tm_commit_pairs,
            commands::glossary_list,
            commands::glossary_add,
            commands::glossary_delete,
            commands::dict_lookup,
            commands::dict_info,
            commands::spell_check,
            commands::spell_add,
            commands::read_styles,
            commands::style_library_load,
            commands::style_library_save,
            fonts::list_fonts,
            fonts::bundled_fonts,
            fonts::bundled_font_data,
            media::video_prepare,
            media::audio_peaks,
            media::video_played,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start HongsaSub")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                media::stop_all();
            }
        });
}
