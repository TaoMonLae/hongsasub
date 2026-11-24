use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use hongsasub_core::{SuggestRequest, TranslationMemory};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::media::quiet_command;
use crate::AppState;

const SERVICE: &str = "HongsaSub";
const ANTHROPIC_DEFAULT: &str = "claude-opus-5-5";
const OPENAI_DEFAULT: &str = "gpt-6.2-astra";
const GEMINI_DEFAULT: &str = "gemini-4-hydrogen";
const TIMEOUT: Duration = Duration::from_secs(600);
const MAX_EXAMPLES: usize = 60;

static CODEX: Mutex<Option<Child>> = Mutex::new(None);

type Examples = Vec<(String, String)>;
type Terms = Vec<(String, String, String)>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    #[default]
    Off,
    Codex,
    Openai,
    Anthropic,
    Gemini,
    Custom,
}

impl Provider {
    fn label(self) -> &'static str {
        match self {
            Provider::Off => "No assistant",
            Provider::Codex => "ChatGPT",
            Provider::Openai => "OpenAI",
            Provider::Anthropic => "Claude",
            Provider::Gemini => "Gemini",
            Provider::Custom => "The provider",
        }
    }

    fn key_page(self) -> Option<&'static str> {
        match self {
            Provider::Openai => Some("https://platform.openai.com/api-keys"),
            Provider::Anthropic => Some("https://console.anthropic.com/settings/keys"),
            Provider::Gemini => Some("https://aistudio.google.com/apikey"),
            _ => None,
        }
    }

    fn key_name(self) -> Option<&'static str> {
        match self {
            Provider::Openai => Some("openai-api-key"),
            Provider::Anthropic => Some("anthropic-api-key"),
            Provider::Gemini => Some("gemini-api-key"),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AssistConfig {
    pub provider: Provider,
    pub anthropic_model: String,
    pub openai_model: String,
    pub gemini_model: String,
    pub codex_model: String,
    pub codex_effort: String,
    pub codex_path: String,
    pub custom_providers: Vec<CustomProvider>,
    pub custom_id: String,
}

impl Default for AssistConfig {
    fn default() -> Self {
        Self {
            provider: Provider::Off,
            anthropic_model: ANTHROPIC_DEFAULT.into(),
            openai_model: OPENAI_DEFAULT.into(),
            gemini_model: GEMINI_DEFAULT.into(),
            codex_model: String::new(),
            codex_effort: String::new(),
            codex_path: String::new(),
            custom_providers: Vec::new(),
            custom_id: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexInfo {
    pub path: Option<String>,
    pub version: String,
    pub signed_in: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexModel {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub efforts: Vec<String>,
    pub default_effort: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistStatus {
    pub config: AssistConfig,
    pub has_anthropic_key: bool,
    pub has_openai_key: bool,
    pub has_gemini_key: bool,
    pub custom_keys: Vec<String>,
    pub key_error: Option<String>,
    pub codex: CodexInfo,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistLine {
    pub id: String,
    pub source: String,
    #[serde(default)]
    pub current: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextLine {
    pub source: String,
    #[serde(default)]
    pub target: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistRequest {
    pub lines: Vec<AssistLine>,
    #[serde(default)]
    pub before: Vec<ContextLine>,
    #[serde(default)]
    pub after: Vec<ContextLine>,
    #[serde(default)]
    pub work: String,
    #[serde(default)]
    pub detail: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistOut {
    pub id: String,
    pub mon: String,
    #[serde(default)]
    pub alternatives: Vec<String>,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistReply {
    pub lines: Vec<AssistOut>,
    pub provider: Provider,
    pub model: String,
    pub seconds: f64,
}

#[derive(Deserialize)]
struct RawReply {
    lines: Vec<AssistOut>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("assist.json"))
}

fn load_config(app: &AppHandle) -> AssistConfig {
    let mut config: AssistConfig = config_path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if config.anthropic_model.trim().is_empty() {
        config.anthropic_model = ANTHROPIC_DEFAULT.into();
    }
    if config.openai_model.trim().is_empty() {
        config.openai_model = OPENAI_DEFAULT.into();
    }
    if config.gemini_model.trim().is_empty() {
        config.gemini_model = GEMINI_DEFAULT.into();
    }
    config
}

fn entry_name(provider: Provider, custom_id: &str) -> Option<String> {
    if provider == Provider::Custom {
        let id = custom_id.trim();
        return (!id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then(|| format!("custom-{id}"));
    }
    provider.key_name().map(str::to_string)
}

fn read_key(provider: Provider) -> Result<Option<String>, String> {
    read_entry(provider, "")
}

fn read_entry(provider: Provider, custom_id: &str) -> Result<Option<String>, String> {
    let Some(name) = entry_name(provider, custom_id) else { return Ok(None) };
    let entry = keyring::Entry::new(SERVICE, &name).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) if !key.trim().is_empty() => Ok(Some(key)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write_key(provider: Provider, custom_id: &str, key: &str) -> Result<(), String> {
    let Some(name) = entry_name(provider, custom_id) else { return Err("This assistant doesn't use an API key.".into()) };
    let entry = keyring::Entry::new(SERVICE, &name).map_err(|e| e.to_string())?;
    let key = key.trim();
    if key.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    entry.set_password(key).map_err(|e| e.to_string())
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

fn codex_candidates(custom: &str) -> Vec<PathBuf> {
    if !custom.trim().is_empty() {
        return vec![PathBuf::from(custom.trim())];
    }
    let names: &[&str] = if cfg!(windows) { &["codex.exe", "codex.cmd"] } else { &["codex"] };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(home) = home() {
        for sub in [".local/bin", ".codex/packages/standalone/current/bin", ".npm-global/bin", ".bun/bin", ".volta/bin", "bin"] {
            dirs.push(home.join(sub));
        }
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(dir));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    let mut seen = HashSet::new();
    dirs.into_iter()
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .filter(|p| p.is_file() && seen.insert(p.clone()))
        .collect()
}

fn codex_command(path: &Path) -> Command {
    let script = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    let mut cmd = if script {
        let mut c = quiet_command("cmd");
        c.arg("/C").arg(path);
        c
    } else {
        quiet_command(path)
    };
    let mut paths: Vec<PathBuf> = Vec::new();
    if let Some(dir) = path.parent() {
        paths.push(dir.to_path_buf());
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
        paths.push(PathBuf::from(dir));
    }
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        cmd.env("PATH", joined);
    }
    cmd
}

fn first_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or_default().to_string()
}

fn codex_info(custom: &str) -> CodexInfo {
    for path in codex_candidates(custom) {
        let Ok(out) = codex_command(&path).arg("--version").stdin(Stdio::null()).output() else { continue };
        if !out.status.success() {
            continue;
        }
        let version = first_line(&out.stdout);
        let login = codex_command(&path).args(["login", "status"]).stdin(Stdio::null()).output();
        let (signed_in, detail) = match login {
            Ok(o) => {
                let text = [first_line(&o.stdout), first_line(&o.stderr)].into_iter().find(|l| !l.is_empty()).unwrap_or_default();
                (o.status.success(), text)
            }
            Err(e) => (false, e.to_string()),
        };
        return CodexInfo { path: Some(path.to_string_lossy().into_owned()), version, signed_in, detail };
    }
    CodexInfo::default()
}

fn find_codex(custom: &str) -> Option<PathBuf> {
    codex_candidates(custom)
        .into_iter()
        .find(|p| codex_command(p).arg("--version").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success()))
}

fn parse_codex_models(text: &str) -> Result<Vec<CodexModel>, String> {
    let start = text.find('{').ok_or("Codex didn't list its models.")?;
    let v: Value = serde_json::from_str(&text[start..]).map_err(|_| "Codex didn't list its models.".to_string())?;
    let mut listed: Vec<(i64, CodexModel)> = v["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["visibility"] == "list")
        .filter_map(|m| {
            let slug = m["slug"].as_str()?.to_string();
            let efforts = m["supported_reasoning_levels"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|l| l["effort"].as_str().map(str::to_string))
                .collect();
            Some((
                m["priority"].as_i64().unwrap_or(i64::MAX),
                CodexModel {
                    name: m["display_name"].as_str().filter(|n| !n.is_empty()).unwrap_or(&slug).to_string(),
                    description: m["description"].as_str().unwrap_or_default().to_string(),
                    default_effort: m["default_reasoning_level"].as_str().unwrap_or_default().to_string(),
                    efforts,
                    slug,
                },
            ))
        })
        .collect();
    listed.sort_by_key(|(priority, _)| *priority);
    Ok(listed.into_iter().map(|(_, m)| m).collect())
}

fn codex_models(path: &Path) -> Result<Vec<CodexModel>, String> {
    let out = codex_command(path).args(["debug", "models"]).stdin(Stdio::null()).output().map_err(|e| format!("Couldn't start Codex: {e}"))?;
    if !out.status.success() {
        return Err(format!("Codex couldn't list its models: {}", first_line(&out.stderr)));
    }
    parse_codex_models(&String::from_utf8_lossy(&out.stdout))
}

fn safe_effort(effort: &str) -> Option<&str> {
    let effort = effort.trim();
    (!effort.is_empty() && effort.chars().all(|c| c.is_ascii_lowercase())).then_some(effort)
}

fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "mon": {"type": "string"},
                        "alternatives": {"type": "array", "items": {"type": "string"}},
                        "note": {"type": "string"}
                    },
                    "required": ["id", "mon", "alternatives", "note"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["lines"],
        "additionalProperties": false
    })
}

fn instructions(detail: bool) -> String {
    let extra = if detail {
        "For each line, also give up to two alternative wordings in \"alternatives\" when a different choice is reasonable, and use \"note\" for one short English sentence about anything the translator should check (a name, an idiom, a guess about meaning). Leave \"note\" empty when there is nothing to say."
    } else {
        "Leave \"alternatives\" empty. Use \"note\" only for one short English sentence when the translator must check something (unclear meaning, wordplay, a name); otherwise leave it empty."
    };
    format!(
        "You translate English film subtitles into Mon (ISO 639-3: mnw), the language of the Mon people of Myanmar and Thailand, for a translator using the subtitle editor HongsaSub.\n\n\
Write in Mon, in Mon script with Mon spelling, using Mon letters such as ၚ ၛ ၜ ၝ ၞ ၟ ၠ ဳ ဴ where Mon uses them. Never write Burmese: Mon and Burmese share a script but are different languages, and a Burmese line is wrong even if it means the same thing.\n\n\
The translator's own work comes first. Their memory examples show how they translate and the words they prefer; follow that style and reuse their wording when the English matches. Use every glossary term exactly as given. Keep names, forms of address and pronouns consistent with the lines around it.\n\n\
These are subtitles, read in a few seconds: translate the meaning naturally and briefly, not word for word. Use at most two lines. \\N marks a line break; keep any {{...}} formatting tags where they belong. Do not add quotation marks, speaker names or explanations to the Mon text.\n\n\
Return one entry for every requested line id, with the Mon text in \"mon\". {extra}"
    )
}

fn user_prompt(req: &AssistRequest, examples: &[(String, String)], terms: &[(String, String, String)]) -> String {
    let mut out = String::new();
    if !req.work.trim().is_empty() {
        out.push_str(&format!("Film: {}\n\n", req.work.trim()));
    }
    if !terms.is_empty() {
        out.push_str("Glossary (use these exactly):\n");
        for (source, target, note) in terms {
            if note.trim().is_empty() {
                out.push_str(&format!("- {source} => {target}\n"));
            } else {
                out.push_str(&format!("- {source} => {target} ({})\n", note.trim()));
            }
        }
        out.push('\n');
    }
    if !examples.is_empty() {
        out.push_str("The translator's memory (English => Mon):\n");
        for (source, target) in examples {
            out.push_str(&format!("- {source} => {target}\n"));
        }
        out.push('\n');
    }
    if !req.before.is_empty() {
        out.push_str("Lines just before (English => Mon, if translated):\n");
        for line in &req.before {
            if line.target.trim().is_empty() {
                out.push_str(&format!("- {}\n", line.source));
            } else {
                out.push_str(&format!("- {} => {}\n", line.source, line.target));
            }
        }
        out.push('\n');
    }
    out.push_str("Translate these lines (id | English | the translator's current draft, if any):\n");
    for line in &req.lines {
        if line.current.trim().is_empty() {
            out.push_str(&format!("{} | {}\n", line.id, line.source));
        } else {
            out.push_str(&format!("{} | {} | draft: {}\n", line.id, line.source, line.current.trim()));
        }
    }
    if !req.after.is_empty() {
        out.push_str("\nLines just after (English):\n");
        for line in &req.after {
            out.push_str(&format!("- {}\n", line.source));
        }
    }
    out
}

fn gather(tm: &TranslationMemory, req: &AssistRequest) -> (Examples, Terms) {
    let mut examples = Vec::new();
    let mut terms = Vec::new();
    let mut seen_examples = HashSet::new();
    let mut seen_terms = HashSet::new();
    for (i, line) in req.lines.iter().enumerate() {
        let prev = if i > 0 { req.lines[i - 1].source.clone() } else { req.before.last().map(|l| l.source.clone()).unwrap_or_default() };
        let next = req.lines.get(i + 1).map(|l| l.source.clone()).or_else(|| req.after.first().map(|l| l.source.clone())).unwrap_or_default();
        let request = SuggestRequest { source: line.source.clone(), prev, next, work: req.work.clone(), limit: Some(4), min_score: Some(55) };
        let Ok(found) = tm.suggest(&request) else { continue };
        for m in found.matches {
            if examples.len() < MAX_EXAMPLES && seen_examples.insert(m.source.clone()) {
                examples.push((m.source, m.target));
            }
        }
        for t in found.terms {
            if seen_terms.insert(t.source.clone()) {
                terms.push((t.source, t.target, t.note));
            }
        }
    }
    (examples, terms)
}

fn api_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| body.chars().take(200).collect())
}

fn http_error(name: &str, status: u16, body: &str) -> String {
    let message = api_message(body);
    let bad_key = status == 400 && message.to_lowercase().contains("api key");
    match status {
        _ if bad_key => format!("{name} didn't accept the API key. Check it in Settings → Assistant."),
        401 | 403 => format!("{name} didn't accept the API key. Check it in Settings → Assistant."),
        429 => format!("{name} is rate-limiting this key or its credit is used up: {message}"),
        529 | 503 => format!("{name} is overloaded right now. Try again in a moment."),
        _ => format!("{name} returned an error ({status}): {message}"),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| e.to_string())
}

async fn call_anthropic(key: &str, model: &str, system: &str, user: &str) -> Result<(String, String), String> {
    let body = json!({
        "model": model,
        "max_tokens": 16000,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "output_config": {"effort": "high", "format": {"type": "json_schema", "schema": schema()}},
        "fallbacks": "default"
    });
    let response = client()?
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2026-10-21")
        .header("anthropic-beta", "server-side-fallback-2026-07-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Claude: {e}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(http_error("Claude", status, &text));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    match v["stop_reason"].as_str() {
        Some("refusal") => return Err("Claude declined to translate these lines.".into()),
        Some("max_tokens") => return Err("Claude's reply was cut short. Try fewer lines at a time.".into()),
        _ => {}
    }
    let out: String = v["content"]
        .as_array()
        .map(|blocks| blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect())
        .unwrap_or_default();
    Ok((out, v["model"].as_str().unwrap_or(model).to_string()))
}

async fn call_openai(key: &str, model: &str, system: &str, user: &str) -> Result<(String, String), String> {
    let body = json!({
        "model": model,
        "instructions": system,
        "input": user,
        "text": {"format": {"type": "json_schema", "name": "mon_subtitles", "schema": schema(), "strict": true}}
    });
    let response = client()?
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach OpenAI: {e}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(http_error("OpenAI", status, &text));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if v["status"] == "incomplete" {
        let reason = v.pointer("/incomplete_details/reason").and_then(Value::as_str).unwrap_or("unknown");
        return Err(if reason == "max_output_tokens" {
            "OpenAI's reply was cut short. Try fewer lines at a time.".into()
        } else {
            format!("OpenAI stopped before finishing ({reason}).")
        });
    }
    let mut out = String::new();
    for item in v["output"].as_array().into_iter().flatten().filter(|i| i["type"] == "message") {
        for part in item["content"].as_array().into_iter().flatten() {
            match part["type"].as_str() {
                Some("output_text") => out.push_str(part["text"].as_str().unwrap_or_default()),
                Some("refusal") => return Err("OpenAI declined to translate these lines.".into()),
                _ => {}
            }
        }
    }
    Ok((out, v["model"].as_str().unwrap_or(model).to_string()))
}

async fn call_gemini(key: &str, model: &str, system: &str, user: &str) -> Result<(String, String), String> {
    let body = json!({
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": schema()}
    });
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent", model.trim());
    let response = client()?
        .post(url)
        .header("x-goog-api-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Gemini: {e}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(http_error("Gemini", status, &text));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if let Some(reason) = v.pointer("/promptFeedback/blockReason").and_then(Value::as_str) {
        return Err(format!("Gemini declined to translate these lines ({reason})."));
    }
    let candidate = &v["candidates"][0];
    match candidate["finishReason"].as_str() {
        Some("MAX_TOKENS") => return Err("Gemini's reply was cut short. Try fewer lines at a time.".into()),
        Some(reason @ ("SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST" | "RECITATION" | "SPII")) => {
            return Err(format!("Gemini declined to translate these lines ({reason})."))
        }
        _ => {}
    }
    let out: String = candidate["content"]["parts"]
        .as_array()
        .map(|parts| parts.iter().filter(|p| p["thought"] != true).filter_map(|p| p["text"].as_str()).collect())
        .unwrap_or_default();
    Ok((out, v["modelVersion"].as_str().unwrap_or(model).to_string()))
}

fn custom_url(base: &str, path: &str) -> Result<reqwest::Url, String> {
    let base = base.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(&format!("{base}/{path}")).map_err(|_| "The server address isn't a valid web address.".to_string())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]" | "::1"));
    match url.scheme() {
        "https" => Ok(url),
        "http" if local => Ok(url),
        _ => Err("Use an https:// address, or http:// only for a server on this computer.".into()),
    }
}

fn json_shape() -> &'static str {
    "Answer with only this JSON and no other text: {\"lines\":[{\"id\":\"...\",\"mon\":\"...\",\"alternatives\":[\"...\"],\"note\":\"...\"}]}"
}

fn read_chat(v: &Value, name: &str) -> Result<String, String> {
    let choice = &v["choices"][0];
    match choice["finish_reason"].as_str() {
        Some("length") => return Err(format!("{name}'s reply was cut short. Try fewer lines at a time.")),
        Some("content_filter") => return Err(format!("{name} declined to translate these lines.")),
        _ => {}
    }
    let message = &choice["message"];
    if message["refusal"].as_str().is_some_and(|r| !r.trim().is_empty()) {
        return Err(format!("{name} declined to translate these lines."));
    }
    let content = &message["content"];
    let text = match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect(),
        _ => String::new(),
    };
    if text.trim().is_empty() {
        return Err(format!("{name} answered with nothing."));
    }
    Ok(text)
}

async fn call_custom(provider: &CustomProvider, key: Option<&str>, system: &str, user: &str) -> Result<(String, String), String> {
    let name = if provider.name.trim().is_empty() { "The provider" } else { provider.name.trim() };
    let model = provider.model.trim();
    if model.is_empty() {
        return Err(format!("Choose a model for {name} in Settings → Assistant."));
    }
    let url = custom_url(&provider.base_url, "chat/completions")?;
    let system = format!("{system}\n\n{}", json_shape());
    let mut body = json!({
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "mon_subtitles", "schema": schema(), "strict": true}}
    });
    let http = client()?;
    for attempt in 0..2 {
        let mut request = http.post(url.clone()).json(&body);
        if let Some(key) = key {
            request = request.bearer_auth(key);
        }
        let response = request.send().await.map_err(|e| format!("Couldn't reach {name}: {e}"))?;
        let status = response.status().as_u16();
        let text = response.text().await.map_err(|e| e.to_string())?;
        if (200..300).contains(&status) {
            let v: Value = serde_json::from_str(&text).map_err(|_| format!("{name} answered, but not in the OpenAI format HongsaSub expects."))?;
            let out = read_chat(&v, name)?;
            return Ok((out, v["model"].as_str().unwrap_or(model).to_string()));
        }
        let retry = attempt == 0 && matches!(status, 400 | 415 | 422) && !api_message(&text).to_lowercase().contains("api key");
        if !retry {
            return Err(http_error(name, status, &text));
        }
        if let Some(object) = body.as_object_mut() {
            object.remove("response_format");
        }
    }
    Err(format!("{name} couldn't answer."))
}

async fn list_custom_models(base_url: &str, key: Option<&str>) -> Result<Vec<String>, String> {
    let url = custom_url(base_url, "models")?;
    let mut request = client()?.get(url);
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|e| format!("Couldn't reach the server: {e}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(http_error("The server", status, &text));
    }
    let v: Value = serde_json::from_str(&text).map_err(|_| "The server didn't return a model list.".to_string())?;
    let mut models: Vec<String> = v["data"]
        .as_array()
        .or_else(|| v["models"].as_array())
        .map(|list| list.iter().filter_map(|m| m["id"].as_str().or_else(|| m["name"].as_str())).map(str::to_string).collect())
        .unwrap_or_default();
    models.sort();
    models.dedup();
    Ok(models)
}

fn call_codex(path: &Path, model: &str, effort: &str, prompt: &str) -> Result<String, String> {
    let dir = std::env::temp_dir().join(format!("hongsasub-assist-{}", uuid::Uuid::new_v4()));
    let work = dir.join("work");
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = run_codex(path, model, effort, prompt, &dir, &work);
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn run_codex(path: &Path, model: &str, effort: &str, prompt: &str, dir: &Path, work: &Path) -> Result<String, String> {
    let schema_path = dir.join("schema.json");
    let out_path = dir.join("reply.json");
    let log_path = dir.join("codex.log");
    std::fs::write(&schema_path, schema().to_string()).map_err(|e| e.to_string())?;
    let log = std::fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let mut cmd = codex_command(path);
    cmd.args(["exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never"])
        .arg("--cd")
        .arg(work)
        .arg("--output-schema")
        .arg(&schema_path)
        .arg("--output-last-message")
        .arg(&out_path);
    if !model.trim().is_empty() {
        cmd.arg("--model").arg(model.trim());
    }
    if let Some(effort) = safe_effort(effort) {
        cmd.arg("--config").arg(format!("model_reasoning_effort=\"{effort}\""));
    }
    cmd.arg("-").current_dir(work).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::from(log));
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start Codex: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).map_err(|e| e.to_string())?;
    }
    *CODEX.lock().map_err(|e| e.to_string())? = Some(child);
    let started = Instant::now();
    let status = loop {
        let mut guard = CODEX.lock().map_err(|e| e.to_string())?;
        let Some(child) = guard.as_mut() else { return Err("Stopped.".into()) };
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            *guard = None;
            break status;
        }
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            *guard = None;
            return Err("Codex took too long to answer.".into());
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(150));
    };
    if !status.success() {
        let log = std::fs::read_to_string(&log_path).unwrap_or_default();
        let lower = log.to_lowercase();
        if lower.contains("model_not_found") || lower.contains("not supported when using codex") {
            return Err("ChatGPT can't use this model with your plan. Pick another model in Settings → Assistant.".into());
        }
        if lower.contains("login") || lower.contains("not logged in") || lower.contains("401") || lower.contains("unauthorized") {
            return Err("Codex isn't signed in. Open a terminal, run codex login, and sign in with your ChatGPT account.".into());
        }
        let last = log.lines().map(str::trim).rfind(|l| !l.is_empty()).unwrap_or("no details").to_string();
        return Err(format!("Codex stopped without an answer: {last}"));
    }
    std::fs::read_to_string(&out_path).map_err(|_| "Codex finished without an answer.".to_string())
}

fn parse_reply(text: &str, req: &AssistRequest) -> Result<Vec<AssistOut>, String> {
    let start = text.find('{').ok_or("The assistant's answer wasn't in the expected form.")?;
    let end = text.rfind('}').ok_or("The assistant's answer wasn't in the expected form.")?;
    let raw: RawReply = serde_json::from_str(&text[start..=end]).map_err(|_| "The assistant's answer wasn't in the expected form.".to_string())?;
    let wanted: HashSet<&str> = req.lines.iter().map(|l| l.id.as_str()).collect();
    let mut seen = HashSet::new();
    Ok(raw
        .lines
        .into_iter()
        .filter(|l| wanted.contains(l.id.as_str()) && seen.insert(l.id.clone()))
        .map(|l| AssistOut {
            mon: l.mon.trim().to_string(),
            alternatives: l.alternatives.into_iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).take(2).collect(),
            note: l.note.trim().to_string(),
            id: l.id,
        })
        .filter(|l| !l.mon.is_empty())
        .collect())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn assist_status(app: AppHandle, full: Option<bool>) -> Result<AssistStatus, String> {
    let config = load_config(&app);
    if !full.unwrap_or(false) {
        return Ok(AssistStatus {
            config,
            has_anthropic_key: false,
            has_openai_key: false,
            has_gemini_key: false,
            custom_keys: Vec::new(),
            key_error: None,
            codex: CodexInfo::default(),
        });
    }
    let custom = config.codex_path.clone();
    let ids: Vec<String> = config.custom_providers.iter().map(|p| p.id.clone()).collect();
    let (anthropic, openai, gemini, codex, custom_keys) = blocking(move || {
        let custom_keys: Vec<String> = ids.into_iter().filter(|id| matches!(read_entry(Provider::Custom, id), Ok(Some(_)))).collect();
        (read_key(Provider::Anthropic), read_key(Provider::Openai), read_key(Provider::Gemini), codex_info(&custom), custom_keys)
    })
    .await?;
    let key_error = anthropic.as_ref().err().or(openai.as_ref().err()).or(gemini.as_ref().err()).cloned();
    Ok(AssistStatus {
        config,
        has_anthropic_key: matches!(anthropic, Ok(Some(_))),
        has_openai_key: matches!(openai, Ok(Some(_))),
        has_gemini_key: matches!(gemini, Ok(Some(_))),
        custom_keys,
        key_error,
        codex,
    })
}

#[tauri::command]
pub async fn assist_configure(app: AppHandle, config: AssistConfig) -> Result<(), String> {
    let path = config_path(&app)?;
    let bytes = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn assist_set_key(provider: Provider, key: String, custom_id: Option<String>) -> Result<(), String> {
    blocking(move || write_key(provider, custom_id.as_deref().unwrap_or(""), &key)).await?
}

#[tauri::command]
pub async fn assist_custom_models(base_url: String, custom_id: Option<String>) -> Result<Vec<String>, String> {
    let id = custom_id.unwrap_or_default();
    let key = blocking(move || read_entry(Provider::Custom, &id)).await??;
    list_custom_models(&base_url, key.as_deref()).await
}

fn open_in_browser(url: &str) -> Result<(), String> {
    let mut cmd = if cfg!(target_os = "macos") {
        quiet_command("open")
    } else if cfg!(windows) {
        let mut c = quiet_command("cmd");
        c.args(["/C", "start", ""]);
        c
    } else {
        quiet_command("xdg-open")
    };
    cmd.arg(url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    cmd.spawn().map(|_| ()).map_err(|e| format!("Couldn't open the browser: {e}"))
}

#[tauri::command]
pub async fn assist_key_page(provider: Provider) -> Result<(), String> {
    let url = provider.key_page().ok_or("This assistant doesn't use an API key.")?;
    open_in_browser(url)
}

#[tauri::command]
pub async fn assist_codex_models(app: AppHandle) -> Result<Vec<CodexModel>, String> {
    let custom = load_config(&app).codex_path;
    blocking(move || {
        let path = find_codex(&custom).ok_or("Codex wasn't found. Install it and sign in with your ChatGPT account first.")?;
        codex_models(&path)
    })
    .await?
}

#[tauri::command]
pub async fn assist_cancel() -> Result<(), String> {
    if let Some(mut child) = CODEX.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
pub async fn assist_translate(app: AppHandle, state: State<'_, AppState>, request: AssistRequest) -> Result<AssistReply, String> {
    let config = load_config(&app);
    if request.lines.is_empty() {
        return Ok(AssistReply { lines: Vec::new(), provider: config.provider, model: String::new(), seconds: 0.0 });
    }
    let (examples, terms) = {
        let tm = state.tm.lock().map_err(|e| e.to_string())?;
        gather(&tm, &request)
    };
    let system = instructions(request.detail);
    let user = user_prompt(&request, &examples, &terms);
    let started = Instant::now();
    let provider = config.provider;
    let (text, model) = match provider {
        Provider::Off => return Err("Choose an assistant in Settings → Assistant first.".into()),
        Provider::Custom => {
            let chosen = config
                .custom_providers
                .iter()
                .find(|p| p.id == config.custom_id)
                .cloned()
                .ok_or("Choose a provider in Settings → Assistant first.")?;
            let id = chosen.id.clone();
            let key = blocking(move || read_entry(Provider::Custom, &id)).await??;
            call_custom(&chosen, key.as_deref(), &system, &user).await?
        }
        Provider::Anthropic | Provider::Openai | Provider::Gemini => {
            let key = blocking(move || read_key(provider))
                .await??
                .ok_or_else(|| format!("Add your {} API key in Settings → Assistant.", provider.label()))?;
            match provider {
                Provider::Anthropic => call_anthropic(&key, &config.anthropic_model, &system, &user).await?,
                Provider::Gemini => call_gemini(&key, &config.gemini_model, &system, &user).await?,
                _ => call_openai(&key, &config.openai_model, &system, &user).await?,
            }
        }
        Provider::Codex => {
            let custom = config.codex_path.clone();
            let model = config.codex_model.clone();
            let effort = config.codex_effort.clone();
            let prompt = format!(
                "{system}\n\nYou are running inside HongsaSub without a person watching. Do not run commands, open files or browse; answer only with the JSON.\n\n{user}"
            );
            let text = blocking(move || {
                let path = find_codex(&custom).ok_or("Codex wasn't found. Install it, sign in with your ChatGPT account, then check Settings → Assistant.")?;
                call_codex(&path, &model, &effort, &prompt)
            })
            .await??;
            (text, if config.codex_model.trim().is_empty() { "Codex".into() } else { config.codex_model.clone() })
        }
    };
    let lines = parse_reply(&text, &request)?;
    Ok(AssistReply { lines, provider, model, seconds: started.elapsed().as_secs_f64() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> AssistRequest {
        AssistRequest {
            lines: vec![
                AssistLine { id: "a".into(), source: "Hello.".into(), current: String::new() },
                AssistLine { id: "b".into(), source: "Goodbye.".into(), current: "draft".into() },
            ],
            before: vec![ContextLine { source: "Earlier.".into(), target: "ဂှ်".into() }],
            after: vec![ContextLine { source: "Later.".into(), target: String::new() }],
            work: "Demo".into(),
            detail: false,
        }
    }

    #[test]
    fn parses_fenced_reply_and_drops_unknown_ids() {
        let text = "```json\n{\"lines\":[{\"id\":\"a\",\"mon\":\" မ္ၚဵု \",\"alternatives\":[\"\",\"x\",\"y\",\"z\"],\"note\":\"\"},{\"id\":\"zz\",\"mon\":\"no\",\"alternatives\":[],\"note\":\"\"},{\"id\":\"a\",\"mon\":\"dup\",\"alternatives\":[],\"note\":\"\"},{\"id\":\"b\",\"mon\":\"  \",\"alternatives\":[],\"note\":\"\"}]}\n```";
        let lines = parse_reply(text, &request()).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].id, "a");
        assert_eq!(lines[0].mon, "မ္ၚဵု");
        assert_eq!(lines[0].alternatives, vec!["x".to_string(), "y".to_string()]);
    }

    #[test]
    fn rejects_non_json() {
        assert!(parse_reply("Sorry, I can't.", &request()).is_err());
    }

    #[test]
    fn prompt_carries_context_glossary_and_drafts() {
        let prompt = user_prompt(&request(), &[("Hi.".into(), "ဟါ".into())], &[("Tokyo".into(), "တဝ်ကျဝ်".into(), "city".into())]);
        assert!(prompt.contains("Film: Demo"));
        assert!(prompt.contains("- Tokyo => တဝ်ကျဝ် (city)"));
        assert!(prompt.contains("- Hi. => ဟါ"));
        assert!(prompt.contains("- Earlier. => ဂှ်"));
        assert!(prompt.contains("a | Hello.\n"));
        assert!(prompt.contains("b | Goodbye. | draft: draft"));
        assert!(prompt.contains("- Later.\n"));
    }

    #[test]
    fn config_defaults_fill_missing_models() {
        let config: AssistConfig = serde_json::from_str("{\"provider\":\"codex\"}").unwrap();
        assert_eq!(config.provider, Provider::Codex);
        assert_eq!(config.anthropic_model, ANTHROPIC_DEFAULT);
        assert_eq!(config.openai_model, OPENAI_DEFAULT);
        assert_eq!(config.gemini_model, GEMINI_DEFAULT);
    }

    #[test]
    fn lists_visible_codex_models_in_priority_order() {
        let text = r#"note
{"models":[
 {"slug":"b","display_name":"B","priority":2,"visibility":"list","description":"Fast","default_reasoning_level":"low","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}]},
 {"slug":"hidden","priority":0,"visibility":"hide"},
 {"slug":"a","display_name":"","priority":1,"visibility":"list"}
]}"#;
        let models = parse_codex_models(text).unwrap();
        assert_eq!(models.iter().map(|m| m.slug.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(models[0].name, "a");
        assert_eq!(models[1].efforts, vec!["low".to_string(), "high".to_string()]);
        assert_eq!(models[1].default_effort, "low");
        assert!(parse_codex_models("nothing").is_err());
    }

    #[test]
    fn effort_values_are_plain_words() {
        assert_eq!(safe_effort(" high "), Some("high"));
        assert_eq!(safe_effort(""), None);
        assert_eq!(safe_effort("high\" x"), None);
    }

    #[test]
    fn custom_addresses_need_https_unless_local() {
        assert_eq!(custom_url("https://openrouter.ai/api/v1/", "chat/completions").unwrap().as_str(), "https://openrouter.ai/api/v1/chat/completions");
        assert!(custom_url("http://localhost:11434/v1", "models").is_ok());
        assert!(custom_url("http://127.0.0.1:1234/v1", "models").is_ok());
        assert!(custom_url("http://example.com/v1", "models").is_err());
        assert!(custom_url("ftp://example.com", "models").is_err());
        assert!(custom_url("not a url", "models").is_err());
    }

    #[test]
    fn custom_keys_get_safe_entry_names() {
        assert_eq!(entry_name(Provider::Custom, "ab-12").as_deref(), Some("custom-ab-12"));
        assert_eq!(entry_name(Provider::Custom, ""), None);
        assert_eq!(entry_name(Provider::Custom, "../x"), None);
        assert_eq!(entry_name(Provider::Openai, "ignored").as_deref(), Some("openai-api-key"));
    }

    #[test]
    fn reads_chat_completions_replies() {
        let ok = json!({"choices": [{"finish_reason": "stop", "message": {"content": "{\"lines\":[]}"}}]});
        assert_eq!(read_chat(&ok, "X").unwrap(), "{\"lines\":[]}");
        let parts = json!({"choices": [{"message": {"content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}}]});
        assert_eq!(read_chat(&parts, "X").unwrap(), "ab");
        let cut = json!({"choices": [{"finish_reason": "length", "message": {"content": "{"}}]});
        assert!(read_chat(&cut, "X").unwrap_err().contains("cut short"));
        let refused = json!({"choices": [{"message": {"content": null, "refusal": "no"}}]});
        assert!(read_chat(&refused, "X").unwrap_err().contains("declined"));
    }

    #[test]
    fn key_pages_are_official_https_sites() {
        for (provider, host) in [(Provider::Openai, "platform.openai.com"), (Provider::Anthropic, "console.anthropic.com"), (Provider::Gemini, "aistudio.google.com")] {
            assert!(provider.key_page().unwrap().starts_with(&format!("https://{host}/")));
        }
        assert!(Provider::Codex.key_page().is_none());
    }
}

#[cfg(test)]
mod live {
    use super::*;

    #[test]
    #[ignore]
    fn codex_lists_models() {
        let models = codex_models(&find_codex("").expect("codex installed")).expect("models");
        println!("{:?}", models.iter().map(|m| (&m.slug, &m.efforts)).collect::<Vec<_>>());
        assert!(!models.is_empty());
    }

    #[test]
    #[ignore]
    fn codex_translates_with_context() {
        let path = find_codex("").expect("codex installed");
        let req = AssistRequest {
            lines: vec![
                AssistLine { id: "l1".into(), source: "Where are you going?".into(), current: String::new() },
                AssistLine { id: "l2".into(), source: "To Tokyo, on the last train.".into(), current: String::new() },
            ],
            before: vec![ContextLine { source: "I hate this town! I hate this life!".into(), target: "အဲချုပ်ချုင်ကၞိကေၠံ! အဲချုပ်ဘဝအဲဏံကေၠံ!".into() }],
            after: vec![],
            work: "Your Name".into(),
            detail: true,
        };
        let prompt = format!("{}\n\n{}", instructions(true), user_prompt(&req, &[], &[("Tokyo".into(), "တဝ်ကျဝ်".into(), String::new())]));
        let model = std::env::var("ASSIST_CODEX_MODEL").unwrap_or_default();
        let effort = std::env::var("ASSIST_CODEX_EFFORT").unwrap_or_default();
        let text = call_codex(&path, &model, &effort, &prompt).expect("codex answer");
        let lines = parse_reply(&text, &req).expect("valid reply");
        println!("{lines:#?}");
        assert_eq!(lines.len(), 2);
    }

    #[test]
    #[ignore]
    fn providers_reject_a_bad_key_with_a_clear_message() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let claude = tauri::async_runtime::block_on(call_anthropic("sk-ant-invalid", ANTHROPIC_DEFAULT, "Translate.", "Hello")).unwrap_err();
        assert!(claude.contains("didn't accept the API key"), "{claude}");
        let openai = tauri::async_runtime::block_on(call_openai("sk-invalid", OPENAI_DEFAULT, "Translate.", "Hello")).unwrap_err();
        assert!(openai.contains("didn't accept the API key"), "{openai}");
        let gemini = tauri::async_runtime::block_on(call_gemini("AIza-invalid", GEMINI_DEFAULT, "Translate.", "Hello")).unwrap_err();
        assert!(gemini.contains("didn't accept the API key"), "{gemini}");
    }

    #[test]
    #[ignore]
    fn ollama_lists_models_and_translates() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let base = std::env::var("ASSIST_BASE").unwrap_or_else(|_| "http://localhost:11434/v1".into());
        let models = tauri::async_runtime::block_on(list_custom_models(&base, None)).expect("models");
        println!("models: {models:?}");
        let provider = CustomProvider { id: "t".into(), name: "Ollama".into(), base_url: base, model: models[0].clone() };
        let req = AssistRequest {
            lines: vec![AssistLine { id: "l1".into(), source: "Where are you going?".into(), current: String::new() }],
            before: vec![],
            after: vec![],
            work: String::new(),
            detail: false,
        };
        let (text, model) = tauri::async_runtime::block_on(call_custom(&provider, None, &instructions(false), &user_prompt(&req, &[], &[]))).expect("answer");
        let lines = parse_reply(&text, &req).expect("valid reply");
        println!("{model}: {lines:?}");
        assert_eq!(lines.len(), 1);
    }
}
