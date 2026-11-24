import { invoke } from "@tauri-apps/api/core";

export type EventKind = "dialogue" | "comment";
export type LineStatus = "untranslated" | "draft" | "confirmed";
export type OpenMode = "translate" | "edit";

export interface SubtitleEvent {
  id: string;
  kind: EventKind;
  layer: number;
  start: number;
  end: number;
  style: string;
  actor: string;
  marginL: string;
  marginR: string;
  marginV: string;
  effect: string;
  text: string;
  extra: Record<string, string>;
  source: string;
  status: LineStatus;
}

export interface Style {
  name: string;
  values: string[];
}

export interface SubtitleDocument {
  format: "ass" | "ssa" | "srt";
  bom: boolean;
  scriptInfo: string[];
  stylesHeader: string;
  styleFormat: string[];
  styles: Style[];
  eventFormat: string[];
  events: SubtitleEvent[];
  rawSections: { header: string; lines: string[] }[];
  order: unknown[];
}

export interface Project {
  version: number;
  id: string;
  title: string;
  work: string;
  sourcePath: string | null;
  videoPath: string | null;
  document: SubtitleDocument;
  createdAt: number;
  updatedAt: number;
}

export interface DiffPart {
  op: "equal" | "insert" | "delete";
  text: string;
}

export interface Suggestion {
  id: string;
  source: string;
  target: string;
  score: number;
  contextMatch: boolean;
  sameWork: boolean;
  work: string;
  useCount: number;
  updatedAt: number;
  diff: DiffPart[];
}

export interface GlossaryTerm {
  id: string;
  source: string;
  target: string;
  note: string;
  updatedAt: number;
}

export interface SuggestResponse {
  matches: Suggestion[];
  terms: GlossaryTerm[];
}

export interface Concordance {
  id: string;
  source: string;
  target: string;
  work: string;
  useCount: number;
  updatedAt: number;
}

export interface TmStats {
  segments: number;
  terms: number;
  works: number;
}

export type PrepareMode = "direct" | "remux" | "transcode";

export interface VideoSource {
  path: string;
  url: string;
  proxied: boolean;
  mode: PrepareMode;
}

export interface VideoProgress {
  source: string;
  mode: PrepareMode;
  ratio: number;
}

export interface Peaks {
  rate: number;
  peaks: number[];
}

export interface DictSense {
  lang: "eng" | "mya" | "tha" | string;
  pos: string;
  text: string;
  example: string;
}

export interface DictEntry {
  id: number;
  word: string;
  ipa: string;
  senses: DictSense[];
}

export interface DictInfo {
  words: number;
  source: string;
  revision: string;
  license: string;
}

export interface SuggestRequest {
  source: string;
  prev: string;
  next: string;
  work: string;
  limit?: number;
}

export type PairFlag = "merged" | "split" | "lowOverlap" | "numbers" | "untranslated" | "long";

export interface PairPreview {
  start: number;
  end: number;
  source: string;
  target: string;
  prev: string;
  next: string;
  overlap: number;
  flags: PairFlag[];
}

export interface PairingPreview {
  pairs: PairPreview[];
  unmatchedSources: number;
  unmatchedTargets: number;
}

export interface Pretranslation {
  target: string;
  score: number;
  contextMatch: boolean;
}

export interface Misspelling {
  start: number;
  len: number;
  word: string;
}

export interface CommitRequest {
  source: string;
  target: string;
  prev: string;
  next: string;
  work: string;
}

export interface MergeCounts {
  added: number;
  updated: number;
  unchanged: number;
}

export interface BackupSummary {
  lines: number;
  terms: number;
  words: number;
  styleCatalogs: number;
}

export interface RestoreSummary {
  lines: MergeCounts;
  terms: MergeCounts;
  words: number;
  styleCatalogs: number;
  createdAt: number;
}

export type AssistProvider = "off" | "codex" | "openai" | "anthropic" | "gemini" | "custom";

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
}

export interface AssistConfig {
  provider: AssistProvider;
  anthropicModel: string;
  openaiModel: string;
  geminiModel: string;
  codexModel: string;
  codexEffort: string;
  codexPath: string;
  customProviders: CustomProvider[];
  customId: string;
}

export interface CodexModel {
  slug: string;
  name: string;
  description: string;
  efforts: string[];
  defaultEffort: string;
}

export interface CodexInfo {
  path: string | null;
  version: string;
  signedIn: boolean;
  detail: string;
}

export interface AssistStatus {
  config: AssistConfig;
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
  hasGeminiKey: boolean;
  customKeys: string[];
  keyError: string | null;
  codex: CodexInfo;
}

export interface AssistLine {
  id: string;
  source: string;
  current?: string;
}

export interface AssistContextLine {
  source: string;
  target?: string;
}

export interface AssistRequest {
  lines: AssistLine[];
  before?: AssistContextLine[];
  after?: AssistContextLine[];
  work?: string;
  detail?: boolean;
}

export interface AssistOut {
  id: string;
  mon: string;
  alternatives: string[];
  note: string;
}

export interface AssistReply {
  lines: AssistOut[];
  provider: AssistProvider;
  model: string;
  seconds: number;
}

export const api = {
  openSubtitle: (path: string, mode: OpenMode) => invoke<Project>("open_subtitle", { path, mode }),
  openProject: (path: string) => invoke<Project>("open_project", { path }),
  saveProject: (path: string, project: Project) => invoke<Project>("save_project", { path, project }),
  exportSubtitle: (path: string, project: Project, fallbackToSource: boolean) =>
    invoke<void>("export_subtitle", { path, project, fallbackToSource }),
  suggest: (request: SuggestRequest) => invoke<SuggestResponse>("tm_suggest", { request }),
  pretranslate: (requests: SuggestRequest[], minScore: number) => invoke<(Pretranslation | null)[]>("tm_pretranslate", { requests, minScore }),
  commit: (request: CommitRequest) => invoke<string | null>("tm_commit", { request }),
  forget: (id: string) => invoke<void>("tm_delete", { id }),
  concordance: (query: string, limit?: number) => invoke<Concordance[]>("tm_concordance", { query, limit }),
  stats: () => invoke<TmStats>("tm_stats"),
  importPair: (sourcePath: string, targetPath: string, work: string) =>
    invoke<number>("tm_import_pair", { sourcePath, targetPath, work }),
  previewPair: (sourcePath: string, targetPath: string) =>
    invoke<PairingPreview>("tm_preview_pair", { sourcePath, targetPath }),
  commitPairs: (pairs: CommitRequest[]) => invoke<number>("tm_commit_pairs", { pairs }),
  memoryBackup: (path: string) => invoke<BackupSummary>("memory_backup", { path }),
  memoryRestore: (path: string) => invoke<RestoreSummary>("memory_restore", { path }),
  memoryFolder: () => invoke<string>("memory_folder"),
  glossaryList: () => invoke<GlossaryTerm[]>("glossary_list"),
  glossaryAdd: (source: string, target: string, note: string) =>
    invoke<GlossaryTerm | null>("glossary_add", { source, target, note }),
  glossaryDelete: (id: string) => invoke<void>("glossary_delete", { id }),
  videoPrepare: (path: string, force?: boolean) => invoke<VideoSource>("video_prepare", { path, force }),
  audioPeaks: (path: string) => invoke<Peaks>("audio_peaks", { path }),
  dictLookup: (query: string, limit?: number) => invoke<DictEntry[]>("dict_lookup", { query, limit }),
  dictInfo: () => invoke<DictInfo>("dict_info"),
  spellCheck: (texts: string[]) => invoke<Misspelling[][]>("spell_check", { texts }),
  spellAdd: (word: string) => invoke<void>("spell_add", { word }),
  videoPlayed: (source: string, playing: string) => invoke<void>("video_played", { source, playing }),
  readStyles: (path: string) => invoke<ScriptStyles>("read_styles", { path }),
  bundledFonts: () => invoke<BundledFont[]>("bundled_fonts"),
  bundledFontData: (file: string) => invoke<ArrayBuffer>("bundled_font_data", { file }),
  styleLibraryLoad: () => invoke<StyleLibrary | null>("style_library_load"),
  styleLibrarySave: (library: StyleLibrary) => invoke<void>("style_library_save", { library }),
  assistStatus: (full = false) => invoke<AssistStatus>("assist_status", { full }),
  assistConfigure: (config: AssistConfig) => invoke<void>("assist_configure", { config }),
  assistSetKey: (provider: AssistProvider, key: string, customId?: string) => invoke<void>("assist_set_key", { provider, key, customId }),
  assistCustomModels: (baseUrl: string, customId: string) => invoke<string[]>("assist_custom_models", { baseUrl, customId }),
  assistCancel: () => invoke<void>("assist_cancel"),
  assistCodexModels: () => invoke<CodexModel[]>("assist_codex_models"),
  assistKeyPage: (provider: AssistProvider) => invoke<void>("assist_key_page", { provider }),
  assistTranslate: (request: AssistRequest) => invoke<AssistReply>("assist_translate", { request }),
  listFonts: () => {
    fontsPromise ??= invoke<string[]>("list_fonts").catch((e) => {
      fontsPromise = null;
      throw e;
    });
    return fontsPromise;
  },
};

let fontsPromise: Promise<string[]> | null = null;

export interface BundledFont {
  family: string;
  weight: string;
  file: string;
}

export interface ScriptStyles {
  styleFormat: string[];
  styles: Style[];
}

export interface StyleLibrary {
  current: string;
  catalogs: Record<string, Style[]>;
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
