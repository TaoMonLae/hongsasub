use std::path::PathBuf;

use hongsasub_core::pairing::{pair_documents, preview_documents, PairingPreview};
use hongsasub_core::project::{read_subtitle, OpenMode};
use hongsasub_core::tm::CommitRequest;
use hongsasub_core::{Misspelling, SpellChecker};
use hongsasub_core::{Concordance, DictEntry, DictInfo, GlossaryTerm, Pretranslation, Project, SuggestRequest, SuggestResponse, TmStats};
use tauri::State;

use crate::{AppState, DictState, SpellState};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn open_subtitle(path: String, mode: OpenMode) -> CmdResult<Project> {
    Project::open_subtitle(PathBuf::from(path), mode).map_err(err)
}

#[tauri::command]
pub async fn open_project(path: String) -> CmdResult<Project> {
    Project::load(PathBuf::from(path)).map_err(err)
}

#[tauri::command]
pub async fn save_project(path: String, mut project: Project) -> CmdResult<Project> {
    project.save(PathBuf::from(path)).map_err(err)?;
    Ok(project)
}

#[tauri::command]
pub async fn export_subtitle(path: String, project: Project, fallback_to_source: bool) -> CmdResult<()> {
    project.export_to(PathBuf::from(path), fallback_to_source).map_err(err)
}

#[tauri::command]
pub async fn tm_suggest(state: State<'_, AppState>, request: SuggestRequest) -> CmdResult<SuggestResponse> {
    state.tm.lock().map_err(err)?.suggest(&request).map_err(err)
}

#[tauri::command]
pub async fn tm_pretranslate(state: State<'_, AppState>, requests: Vec<SuggestRequest>, min_score: u8) -> CmdResult<Vec<Option<Pretranslation>>> {
    state.tm.lock().map_err(err)?.pretranslate(&requests, min_score.clamp(50, 100)).map_err(err)
}

#[tauri::command]
pub async fn tm_commit(state: State<'_, AppState>, request: CommitRequest) -> CmdResult<Option<String>> {
    state.tm.lock().map_err(err)?.commit(&request).map_err(err)
}

#[tauri::command]
pub async fn tm_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.tm.lock().map_err(err)?.delete_segment(&id).map_err(err)
}

#[tauri::command]
pub async fn tm_concordance(state: State<'_, AppState>, query: String, limit: Option<usize>) -> CmdResult<Vec<Concordance>> {
    state.tm.lock().map_err(err)?.concordance(&query, limit.unwrap_or(60)).map_err(err)
}

#[tauri::command]
pub async fn tm_stats(state: State<'_, AppState>) -> CmdResult<TmStats> {
    state.tm.lock().map_err(err)?.stats().map_err(err)
}

#[tauri::command]
pub async fn tm_import_pair(
    state: State<'_, AppState>,
    source_path: String,
    target_path: String,
    work: String,
) -> CmdResult<usize> {
    let source = read_subtitle(PathBuf::from(source_path)).map_err(err)?;
    let target = read_subtitle(PathBuf::from(target_path)).map_err(err)?;
    let pairs = pair_documents(&source, &target, &work);
    state.tm.lock().map_err(err)?.commit_many(&pairs).map_err(err)
}

#[tauri::command]
pub async fn tm_preview_pair(source_path: String, target_path: String) -> CmdResult<PairingPreview> {
    let source = read_subtitle(PathBuf::from(source_path)).map_err(err)?;
    let target = read_subtitle(PathBuf::from(target_path)).map_err(err)?;
    Ok(preview_documents(&source, &target))
}

#[tauri::command]
pub async fn tm_commit_pairs(state: State<'_, AppState>, pairs: Vec<CommitRequest>) -> CmdResult<usize> {
    state.tm.lock().map_err(err)?.commit_many(&pairs).map_err(err)
}

#[tauri::command]
pub async fn glossary_list(state: State<'_, AppState>) -> CmdResult<Vec<GlossaryTerm>> {
    state.tm.lock().map_err(err)?.list_terms().map_err(err)
}

#[tauri::command]
pub async fn glossary_add(
    state: State<'_, AppState>,
    source: String,
    target: String,
    note: String,
) -> CmdResult<Option<GlossaryTerm>> {
    state.tm.lock().map_err(err)?.add_term(&source, &target, &note).map_err(err)
}

#[tauri::command]
pub async fn glossary_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.tm.lock().map_err(err)?.delete_term(&id).map_err(err)
}

fn with_dict<T>(state: &DictState, f: impl FnOnce(&hongsasub_core::Dictionary) -> hongsasub_core::Result<T>) -> CmdResult<T> {
    let guard = state.dict.lock().map_err(err)?;
    match guard.as_ref() {
        Some(dict) => f(dict).map_err(err),
        None => Err(format!("The dictionary is not available: {}", state.error.clone().unwrap_or_default())),
    }
}

#[tauri::command]
pub async fn dict_lookup(state: State<'_, DictState>, query: String, limit: Option<usize>) -> CmdResult<Vec<DictEntry>> {
    with_dict(&state, |d| d.lookup(&query, limit.unwrap_or(30).min(100)))
}

#[tauri::command]
pub async fn dict_info(state: State<'_, DictState>) -> CmdResult<DictInfo> {
    with_dict(&state, |d| d.info())
}

fn spell_words_path(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("spell_words.json"))
}

fn user_words(app: &tauri::AppHandle) -> Vec<String> {
    spell_words_path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Vec<String>>(&b).ok())
        .unwrap_or_default()
}

fn build_checker(app: &tauri::AppHandle, dict: &DictState, tm: &AppState) -> CmdResult<SpellChecker> {
    let words = {
        let guard = dict.dict.lock().map_err(err)?;
        match guard.as_ref() {
            Some(d) => d.all_words().map_err(err)?,
            None => return Err(format!("The dictionary is not available: {}", dict.error.clone().unwrap_or_default())),
        }
    };
    let mut checker = SpellChecker::new(words.into_iter().chain(user_words(app)));
    let targets = tm.tm.lock().map_err(err)?.all_targets().map_err(err)?;
    checker.learn_frequent(targets.iter().map(String::as_str), 3);
    Ok(checker)
}

#[tauri::command]
pub async fn spell_check(
    app: tauri::AppHandle,
    spell: State<'_, SpellState>,
    dict: State<'_, DictState>,
    tm: State<'_, AppState>,
    texts: Vec<String>,
) -> CmdResult<Vec<Vec<Misspelling>>> {
    let mut guard = spell.checker.lock().map_err(err)?;
    if guard.is_none() {
        *guard = Some(build_checker(&app, &dict, &tm)?);
    }
    let checker = guard.as_ref().ok_or("The spell checker is not ready")?;
    Ok(texts.iter().map(|t| checker.check(t)).collect())
}

#[tauri::command]
pub async fn spell_add(app: tauri::AppHandle, spell: State<'_, SpellState>, word: String) -> CmdResult<()> {
    let word = word.trim().to_string();
    if word.is_empty() {
        return Ok(());
    }
    let mut words = user_words(&app);
    if !words.contains(&word) {
        words.push(word.clone());
        let path = spell_words_path(&app)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&words).map_err(err)?).map_err(err)?;
        std::fs::rename(&tmp, &path).map_err(err)?;
    }
    if let Some(checker) = spell.checker.lock().map_err(err)?.as_mut() {
        checker.add(&word);
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptStyles {
    pub style_format: Vec<String>,
    pub styles: Vec<hongsasub_core::Style>,
}

#[tauri::command]
pub async fn read_styles(path: String) -> CmdResult<ScriptStyles> {
    let doc = read_subtitle(PathBuf::from(path)).map_err(err)?;
    Ok(ScriptStyles { style_format: doc.style_format, styles: doc.styles })
}

fn style_library_path(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("styles.json"))
}

#[tauri::command]
pub async fn style_library_load(app: tauri::AppHandle) -> CmdResult<serde_json::Value> {
    let path = style_library_path(&app)?;
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(err),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
pub async fn style_library_save(app: tauri::AppHandle, library: serde_json::Value) -> CmdResult<()> {
    let path = style_library_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&library).map_err(err)?).map_err(err)?;
    std::fs::rename(&tmp, &path).map_err(err)
}
