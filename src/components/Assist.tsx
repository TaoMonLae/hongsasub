import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, type CodexModel, type CustomProvider, type AssistConfig, type AssistOut, type AssistProvider, type AssistReply, type AssistRequest, type AssistStatus } from "../lib/api";
import { displayLines } from "../lib/text";
import { MOD } from "../lib/keys";
import { Shell } from "./Modals";

export const PROVIDERS: { id: AssistProvider; label: string; name: string }[] = [
  { id: "off", label: "Off", name: "No assistant" },
  { id: "codex", label: "ChatGPT plan", name: "ChatGPT" },
  { id: "openai", label: "OpenAI API", name: "OpenAI" },
  { id: "anthropic", label: "Claude API", name: "Claude" },
  { id: "gemini", label: "Gemini API", name: "Gemini" },
  { id: "custom", label: "Other", name: "the provider" },
];

const PRESETS: { id: string; label: string; name: string; baseUrl: string }[] = [
  { id: "openrouter", label: "OpenRouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "deepseek", label: "DeepSeek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { id: "mistral", label: "Mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { id: "groq", label: "Groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "xai", label: "xAI (Grok)", name: "Grok", baseUrl: "https://api.x.ai/v1" },
  { id: "together", label: "Together AI", name: "Together AI", baseUrl: "https://api.together.xyz/v1" },
  { id: "ollama", label: "Ollama on this computer", name: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { id: "lmstudio", label: "LM Studio on this computer", name: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  { id: "other", label: "Another OpenAI-compatible service", name: "", baseUrl: "" },
];

const ANTHROPIC_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5, best quality" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5, faster" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5, cheapest" },
];

const OPENAI_MODELS = [
  { id: "gpt-6.2-astra", label: "GPT-6.2 Astra, best quality" },
  { id: "gpt-6.2-sol", label: "GPT-6.2 Sol" },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
  { id: "gpt-6-luna", label: "GPT-6 Luna, cheapest" },
];

const GEMINI_MODELS = [
  { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen · free" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash · free, faster" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite · free, fastest" },
  { id: "gemini-4-carbon", label: "Gemini 4 Carbon · paid keys only" },
];

const BATCH = 15;

export function providerName(provider: AssistProvider | undefined) {
  return PROVIDERS.find((p) => p.id === provider)?.name ?? "the assistant";
}

export function assistName(status: AssistStatus | null) {
  const config = status?.config;
  if (config?.provider === "custom") return config.customProviders.find((p) => p.id === config.customId)?.name.trim() || "the provider";
  return providerName(config?.provider);
}

function isLocal(url: string) {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url.trim());
}

export function toSubtitleText(text: string) {
  return text.replace(/\r?\n/g, "\\N").trim();
}

function seconds(s: number) {
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

export interface LineSuggestion {
  reply: AssistReply;
  out: AssistOut | null;
}

export function useAssist(onNotify: (text: string, tone?: "ok" | "error") => void) {
  const [status, setStatus] = useState<AssistStatus | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, LineSuggestion>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const runRef = useRef(0);

  const refresh = useCallback(async (full = false) => {
    try {
      const s = await api.assistStatus(full);
      setStatus(s);
      return s;
    } catch (e) {
      onNotify(errorText(e), "error");
      return null;
    }
  }, [onNotify]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ask = useCallback(async (id: string, request: AssistRequest) => {
    const run = ++runRef.current;
    setBusyId(id);
    setErrors((e) => {
      const { [id]: _gone, ...rest } = e;
      return rest;
    });
    try {
      const reply = await api.assistTranslate({ ...request, detail: true });
      if (run !== runRef.current) return;
      const out = reply.lines.find((l) => l.id === id) ?? null;
      setResults((r) => ({ ...r, [id]: { reply, out } }));
      if (!out) setErrors((e) => ({ ...e, [id]: "The assistant didn't return a translation for this line. Try again." }));
    } catch (e) {
      if (run !== runRef.current) return;
      setErrors((err) => ({ ...err, [id]: errorText(e) }));
    } finally {
      if (run === runRef.current) setBusyId(null);
    }
  }, []);

  const stop = useCallback(() => {
    runRef.current++;
    setBusyId(null);
    api.assistCancel().catch(() => undefined);
  }, []);

  return { status, refresh, ask, stop, busyId, results, errors };
}

export function AssistPanel({
  status,
  line,
  busy,
  suggestion,
  error,
  onAsk,
  onStop,
  onUse,
  onInsert,
  onSetup,
  onDraftMany,
}: {
  status: AssistStatus | null;
  line: { id: string; source: string } | null;
  busy: boolean;
  suggestion: LineSuggestion | null;
  error: string | null;
  onAsk: () => void;
  onStop: () => void;
  onUse: (text: string) => void;
  onInsert: (text: string) => void;
  onSetup: () => void;
  onDraftMany: () => void;
}) {
  const provider = status?.config.provider ?? "off";
  if (provider === "off") {
    return (
      <div className="assist assist--setup">
        <p className="empty">
          Ask ChatGPT, Claude, Gemini or another AI for a Mon translation of the line you're on. It uses your memory and glossary, and its answer arrives as a draft for you to
          check.
        </p>
        <button className="btn" onClick={onSetup}>
          Set up the assistant…
        </button>
      </div>
    );
  }
  const name = assistName(status);
  const out = suggestion?.out ?? null;
  const options = out ? [out.mon, ...out.alternatives] : [];
  return (
    <div className="assist">
      {!line || !line.source.trim() ? (
        <p className="empty">Select a line with English text, then ask {name} for a translation.</p>
      ) : (
        <>
          <div className="assist__ask">
            {busy ? (
              <>
                <span className="assist__busy" role="status">
                  Asking {name}…
                </span>
                <button className="btn btn--small" onClick={onStop}>
                  Stop
                </button>
              </>
            ) : (
              <button className="btn btn--primary" onClick={onAsk} title={`Ask ${name}  ${MOD}J`}>
                {out ? "Ask again" : `Ask ${name}`}
                <kbd>{MOD}J</kbd>
              </button>
            )}
          </div>
          {error && !busy && (
            <p className="assist__error" role="alert">
              {error}
            </p>
          )}
          {out && (
            <ol className="match-list">
              {options.map((text, i) => (
                <li key={`${i}-${text}`} className="match match--high">
                  <button className="match__body" onClick={() => onUse(text)} title="Use this as the draft">
                    <span className="match__top">
                      <span className="tag">{i === 0 ? "Suggested" : "Another way"}</span>
                    </span>
                    <span className="match__target mon">{displayLines(text)}</span>
                  </button>
                  <button className="assist__insert btn btn--plain btn--small" onClick={() => onInsert(text)} title="Insert at the cursor">
                    Insert
                  </button>
                </li>
              ))}
            </ol>
          )}
          {out?.note && <p className="assist__note">{out.note}</p>}
          {suggestion && (
            <p className="match__meta assist__meta">
              {suggestion.reply.model} · {seconds(suggestion.reply.seconds)} · Check it before you confirm.
            </p>
          )}
        </>
      )}
      <div className="assist__more">
        <button className="btn btn--plain btn--small" onClick={onDraftMany}>
          Draft untranslated lines…
        </button>
      </div>
    </div>
  );
}

type Scope = "all" | "after";

export function AssistDraftModal({
  provider,
  name,
  open,
  openAfter,
  pick,
  build,
  apply,
  onDone,
  onClose,
}: {
  provider: AssistProvider;
  name: string;
  open: number;
  openAfter: number;
  pick: (scope: Scope) => string[];
  build: (ids: string[]) => AssistRequest;
  apply: (lines: AssistOut[]) => number;
  onDone: (drafted: number, error: string | null) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const stopRef = useRef(false);

  const run = async () => {
    const ids = pick(scope);
    if (!ids.length) return;
    stopRef.current = false;
    setRunning(true);
    setTotal(ids.length);
    setDone(0);
    let drafted = 0;
    let error: string | null = null;
    for (let i = 0; i < ids.length && !stopRef.current; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      try {
        const reply = await api.assistTranslate({ ...build(chunk), detail: false });
        if (stopRef.current) break;
        drafted += apply(reply.lines);
      } catch (e) {
        if (!stopRef.current) error = errorText(e);
        break;
      }
      setDone(Math.min(ids.length, i + chunk.length));
    }
    setRunning(false);
    onDone(drafted, error);
  };

  const stop = () => {
    stopRef.current = true;
    api.assistCancel().catch(() => undefined);
  };

  const count = scope === "all" ? open : openAfter;
  return (
    <Shell title="Draft with the assistant" onClose={running ? stop : onClose}>
      <p className="modal__lead">
        {name} translates the untranslated lines {BATCH} at a time, using your memory and glossary. Each line gets a draft; nothing is confirmed until you check
        it. You can stop at any time and keep what's done.
      </p>
      <div className="segmented segmented--wide" role="radiogroup" aria-label="Which lines">
        <button role="radio" aria-checked={scope === "all"} className={scope === "all" ? "is-on" : ""} onClick={() => setScope("all")} disabled={running}>
          Every untranslated line <em className="num">{open.toLocaleString()}</em>
        </button>
        <button role="radio" aria-checked={scope === "after"} className={scope === "after" ? "is-on" : ""} onClick={() => setScope("after")} disabled={running}>
          From the selected line on <em className="num">{openAfter.toLocaleString()}</em>
        </button>
      </div>
      {running ? (
        <div className="assist__progress" role="status">
          <progress max={total} value={done} />
          <span className="num">
            {done.toLocaleString()} of {total.toLocaleString()} lines
          </span>
        </div>
      ) : (
        <p className="tools__note">
          Lines and nearby context are sent to {name}. {provider === "codex" ? "This uses your ChatGPT plan's Codex allowance." : provider === "custom" ? "" : "This is billed to your API account."}
        </p>
      )}
      <div className="modal__actions">
        {running ? (
          <button className="btn" onClick={stop}>
            Stop
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn--primary" disabled={count === 0} onClick={run}>
              Draft {count.toLocaleString()} {count === 1 ? "line" : "lines"}
            </button>
          </>
        )}
      </div>
    </Shell>
  );
}

function KeyField({
  provider,
  customId,
  saved,
  onSaved,
}: {
  provider: "openai" | "anthropic" | "gemini" | "custom";
  customId?: string;
  saved: boolean;
  onSaved: (message: string, tone: "ok" | "error") => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const store = async (key: string) => {
    setBusy(true);
    try {
      await api.assistSetKey(provider, key, customId);
      setValue("");
      onSaved(key ? "Key saved in this computer's secure key store." : "Key removed.", "ok");
    } catch (e) {
      onSaved(`Couldn't save the key. ${errorText(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="assist__key">
      <input
        type="password"
        className="field"
        placeholder={saved ? "Saved. Paste a new key to replace it" : provider === "openai" ? "sk-…" : provider === "gemini" ? "AIza…" : provider === "custom" ? "Paste the key" : "sk-ant-…"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label="API key"
      />
      <button className="btn" disabled={busy || !value.trim()} onClick={() => store(value)}>
        Save
      </button>
      {saved ? (
        <button className="btn btn--plain" disabled={busy} onClick={() => store("")}>
          Remove
        </button>
      ) : provider === "custom" ? null : (
        <button className="btn btn--plain" onClick={() => api.assistKeyPage(provider).catch((e) => onSaved(errorText(e), "error"))}>
          {provider === "gemini" ? "Get a free key" : "Get a key"}
        </button>
      )}
    </div>
  );
}

function ModelSelect({ value, options, onChange }: { value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) {
  const list = options.some((o) => o.id === value) ? options : [...options, { id: value, label: value }];
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Model">
      {list.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TextSetting({ value, placeholder, label, onCommit }: { value: string; placeholder: string; label: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="field"
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onCommit(draft.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function AssistantPage({
  status,
  onRefresh,
  Row,
}: {
  status: AssistStatus | null;
  onRefresh: (full?: boolean) => Promise<AssistStatus | null>;
  Row: (props: { label: string; note?: string; children: React.ReactNode }) => React.ReactElement;
}) {
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error"; mon?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    onRefresh(true).then(() => setLoaded(true));
  }, [onRefresh]);
  if (!status || !loaded) return <p className="modal__lead">Loading…</p>;
  const config = status.config;
  const provider = config.provider;
  const name = assistName(status);
  const activeCustom = config.customProviders.find((p) => p.id === config.customId) ?? null;

  const update = async (patch: Partial<AssistConfig>) => {
    setMessage(null);
    try {
      await api.assistConfigure({ ...config, ...patch });
      await onRefresh(true);
    } catch (e) {
      setMessage({ text: errorText(e), tone: "error" });
    }
  };

  const check = async () => {
    setChecking(true);
    await onRefresh(true);
    setChecking(false);
  };

  const test = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const reply = await api.assistTranslate({ lines: [{ id: "test", source: "Good morning, everyone." }], detail: false });
      const mon = reply.lines[0]?.mon;
      setMessage(
        mon
          ? { tone: "ok", text: `${name} answered in ${seconds(reply.seconds)}: “Good morning, everyone.” → `, mon }
          : { tone: "error", text: `${name} answered but gave no translation.` },
      );
    } catch (e) {
      setMessage({ text: errorText(e), tone: "error" });
    } finally {
      setTesting(false);
    }
  };

  const ready =
    provider === "codex"
      ? Boolean(status.codex.path && status.codex.signedIn)
      : provider === "openai"
        ? status.hasOpenaiKey
        : provider === "anthropic"
          ? status.hasAnthropicKey
          : provider === "gemini"
            ? status.hasGeminiKey
            : provider === "custom"
              ? Boolean(activeCustom?.baseUrl.trim() && activeCustom.model.trim())
              : false;

  return (
    <>
      <p className="modal__lead">
        An AI assistant can suggest a Mon translation for the line you're on, or draft many untranslated lines at once. It uses your memory and glossary, it
        only runs when you ask, and everything it writes arrives as a draft for you to check.
      </p>
      <Row label="Assistant">
        <div className="segmented" role="radiogroup" aria-label="Assistant">
          {PROVIDERS.map((p) => (
            <button key={p.id} role="radio" aria-checked={provider === p.id} className={provider === p.id ? "is-on" : ""} onClick={() => update({ provider: p.id })}>
              {p.label}
            </button>
          ))}
        </div>
      </Row>

      {provider === "codex" && (
        <>
          <Row
            label="Codex"
            note={
              status.codex.path
                ? status.codex.signedIn
                  ? `${status.codex.version || "Codex"} · ${status.codex.detail || "Signed in"}`
                  : "Codex is installed but not signed in. Open a terminal, run codex login, and sign in with your ChatGPT account."
                : "Uses your ChatGPT Plus, Pro, Business or Enterprise plan through OpenAI's Codex app. Install Codex from developers.openai.com/codex, run codex login, and sign in with your ChatGPT account."
            }
          >
            <button className="btn" onClick={check} disabled={checking}>
              {checking ? "Checking…" : "Check again"}
            </button>
          </Row>
          {status.codex.path && status.codex.signedIn && <CodexModels config={config} update={update} onMessage={(text, tone) => setMessage({ text, tone })} Row={Row} />}
          <Row label="Codex location" note={status.codex.path ? `Found at ${status.codex.path}` : "Only needed if HongsaSub can't find Codex on its own."}>
            <TextSetting value={config.codexPath} placeholder="Found automatically" label="Codex location" onCommit={(v) => update({ codexPath: v })} />
          </Row>
        </>
      )}

      {provider === "openai" && (
        <>
          <Row label="API key" note="From platform.openai.com, billed to your API account. A ChatGPT plan doesn't cover API use.">
            <KeyField provider="openai" saved={status.hasOpenaiKey} onSaved={async (text, tone) => (setMessage({ text, tone }), await onRefresh(true))} />
          </Row>
          <Row label="Model">
            <ModelSelect value={config.openaiModel} options={OPENAI_MODELS} onChange={(id) => update({ openaiModel: id })} />
          </Row>
        </>
      )}

      {provider === "anthropic" && (
        <>
          <Row
            label="API key"
            note="From console.anthropic.com, billed to your API account. Claude Pro and Max plans can't be used: Anthropic doesn't allow other apps to use them."
          >
            <KeyField provider="anthropic" saved={status.hasAnthropicKey} onSaved={async (text, tone) => (setMessage({ text, tone }), await onRefresh(true))} />
          </Row>
          <Row label="Model">
            <ModelSelect value={config.anthropicModel} options={ANTHROPIC_MODELS} onChange={(id) => update({ anthropicModel: id })} />
          </Row>
        </>
      )}

      {provider === "gemini" && (
        <>
          <Row
            label="API key"
            note="Free from Google AI Studio, with no card needed. Google AI Pro and Ultra plans can't be used here: Google doesn't allow it."
          >
            <KeyField provider="gemini" saved={status.hasGeminiKey} onSaved={async (text, tone) => (setMessage({ text, tone }), await onRefresh(true))} />
          </Row>
          <Row label="Model">
            <ModelSelect value={config.geminiModel} options={GEMINI_MODELS} onChange={(id) => update({ geminiModel: id })} />
          </Row>
        </>
      )}

      {provider === "custom" && (
        <CustomSection status={status} update={update} onRefresh={onRefresh} onMessage={(text, tone) => setMessage({ text, tone })} Row={Row} />
      )}

      {provider !== "off" && (
        <Row label="Try it" note="Translates one short line so you can see it working.">
          <button className="btn" onClick={test} disabled={testing || !ready}>
            {testing ? `Asking ${name}…` : "Test"}
          </button>
        </Row>
      )}

      <p className={`settings__status${message?.tone === "error" || status.keyError ? " is-error" : ""}`} role={message?.tone === "error" ? "alert" : "status"}>
        {message?.text ?? (status.keyError ? `The secure key store isn't available: ${status.keyError}` : "")}
        {message?.mon && <span className="mon">{message.mon}</span>}
      </p>

      {provider !== "off" && (
        <p className="settings__fineprint">
          When you ask, the English of those lines, a few lines around them, matching lines from your memory and the glossary terms they use are sent to {name}.
          Nothing else leaves your computer, and nothing is sent until you ask.
          {provider === "gemini" && " With a free Gemini key, Google may use what you send to improve its products; turning on billing for the key stops that."} Mon is a
          rare language for AI models, so check every line: they sometimes slip into Burmese.
        </p>
      )}
    </>
  );
}

function CustomSection({
  status,
  update,
  onRefresh,
  onMessage,
  Row,
}: {
  status: AssistStatus;
  update: (patch: Partial<AssistConfig>) => Promise<void>;
  onRefresh: (full?: boolean) => Promise<AssistStatus | null>;
  onMessage: (text: string, tone: "ok" | "error") => void;
  Row: (props: { label: string; note?: string; children: React.ReactNode }) => React.ReactElement;
}) {
  const config = status.config;
  const list = config.customProviders;
  const active = list.find((p) => p.id === config.customId) ?? list[0] ?? null;
  const [adding, setAdding] = useState(list.length === 0);
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [draftName, setDraftName] = useState(PRESETS[0].name);
  const [draftUrl, setDraftUrl] = useState(PRESETS[0].baseUrl);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => setModels([]), [active?.id, active?.baseUrl]);

  const choose = (id: string) => {
    const p = PRESETS.find((x) => x.id === id) ?? PRESETS[PRESETS.length - 1];
    setPreset(p.id);
    setDraftName(p.name);
    setDraftUrl(p.baseUrl);
  };

  const add = async () => {
    const entry: CustomProvider = { id: crypto.randomUUID(), name: draftName.trim() || "My provider", baseUrl: draftUrl.trim(), model: "" };
    await update({ customProviders: [...list, entry], customId: entry.id });
    setAdding(false);
  };

  const patch = (change: Partial<CustomProvider>) => {
    if (!active) return Promise.resolve();
    return update({ customProviders: list.map((p) => (p.id === active.id ? { ...p, ...change } : p)), customId: active.id });
  };

  const remove = async () => {
    if (!active) return;
    await api.assistSetKey("custom", "", active.id).catch(() => undefined);
    const rest = list.filter((p) => p.id !== active.id);
    await update({ customProviders: rest, customId: rest[0]?.id ?? "" });
    if (!rest.length) setAdding(true);
  };

  const load = async () => {
    if (!active) return;
    setLoading(true);
    try {
      const found = await api.assistCustomModels(active.baseUrl, active.id);
      setModels(found);
      onMessage(found.length ? `${active.name} offers ${found.length.toLocaleString()} models. Pick one from the list.` : `${active.name} listed no models. Type the model name instead.`, "ok");
    } catch (e) {
      onMessage(errorText(e), "error");
    } finally {
      setLoading(false);
    }
  };

  if (adding || !active) {
    return (
      <>
        <Row label="Start from" note="Any service with an OpenAI-compatible API works, including models running on this computer.">
          <select className="field" value={preset} onChange={(e) => choose(e.target.value)} aria-label="Provider preset">
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Name">
          <input className="field" value={draftName} placeholder="My provider" onChange={(e) => setDraftName(e.target.value)} aria-label="Provider name" />
        </Row>
        <Row label="Server address" note="The API address, usually ending in /v1. Use https://, or http:// only for a server on this computer.">
          <input className="field" value={draftUrl} placeholder="https://…/v1" spellCheck={false} onChange={(e) => setDraftUrl(e.target.value)} aria-label="Server address" />
        </Row>
        <div className="assist__actions">
          {list.length > 0 && (
            <button className="btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
          )}
          <button className="btn btn--primary" disabled={!draftUrl.trim()} onClick={add}>
            Add provider
          </button>
        </div>
      </>
    );
  }

  const modelOptions = models.includes(active.model) || !active.model ? models : [active.model, ...models];
  return (
    <>
      <Row label="Provider">
        <div className="assist__key">
          <select
            className="field"
            value={active.id}
            aria-label="Provider"
            onChange={(e) => (e.target.value === "__add" ? (choose(PRESETS[0].id), setAdding(true)) : update({ customId: e.target.value }))}
          >
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.baseUrl}
              </option>
            ))}
            <option value="__add">Add another…</option>
          </select>
          <button className="btn btn--plain" onClick={remove}>
            Remove
          </button>
        </div>
      </Row>
      <Row label="Server address">
        <TextSetting value={active.baseUrl} placeholder="https://…/v1" label="Server address" onCommit={(v) => patch({ baseUrl: v })} />
      </Row>
      <Row label="API key" note={isLocal(active.baseUrl) ? "Most servers on this computer don't need one." : "Kept in this computer's secure key store."}>
        <KeyField
          provider="custom"
          customId={active.id}
          saved={status.customKeys.includes(active.id)}
          onSaved={async (text, tone) => (onMessage(text, tone), await onRefresh(true))}
        />
      </Row>
      <Row label="Model" note={models.length ? "Pick a model from the list." : "Load the server's list, or type a model name."}>
        <div className="assist__key">
          {models.length ? (
            <select className="field" value={active.model} onChange={(e) => patch({ model: e.target.value })} aria-label="Model">
              {!active.model && <option value="">Choose a model</option>}
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <TextSetting value={active.model} placeholder="Model name" label="Model" onCommit={(v) => patch({ model: v })} />
          )}
          <button className="btn" onClick={load} disabled={loading || !active.baseUrl.trim()}>
            {loading ? "Loading…" : "Load models"}
          </button>
        </div>
      </Row>
    </>
  );
}

const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low, fastest",
  medium: "Medium",
  high: "High, more careful",
  xhigh: "Extra high",
  max: "Maximum",
  ultra: "Ultra, slowest",
};

function CodexModels({
  config,
  update,
  onMessage,
  Row,
}: {
  config: AssistConfig;
  update: (patch: Partial<AssistConfig>) => Promise<void>;
  onMessage: (text: string, tone: "ok" | "error") => void;
  Row: (props: { label: string; note?: string; children: React.ReactNode }) => React.ReactElement;
}) {
  const [models, setModels] = useState<CodexModel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const messageRef = useRef(onMessage);
  messageRef.current = onMessage;
  useEffect(() => {
    let live = true;
    api
      .assistCodexModels()
      .then((list) => live && setModels(list))
      .catch((e) => {
        if (!live) return;
        setFailed(true);
        messageRef.current(errorText(e), "error");
      });
    return () => {
      live = false;
    };
  }, []);

  const chosen = models?.find((m) => m.slug === config.codexModel) ?? null;
  const efforts = chosen?.efforts ?? Array.from(new Set((models ?? []).flatMap((m) => m.efforts)));
  const unknown = Boolean(config.codexModel) && models !== null && !chosen;

  if (failed || (models !== null && models.length === 0)) {
    return (
      <Row label="Model" note="Leave empty to use Codex's own default.">
        <TextSetting value={config.codexModel} placeholder="Codex default" label="Codex model" onCommit={(v) => update({ codexModel: v })} />
      </Row>
    );
  }

  return (
    <>
      <Row
        label="Model"
        note={
          models === null
            ? "Asking Codex which models your plan can use…"
            : unknown
              ? "This model isn't in your plan's list any more. Pick another."
              : chosen?.description || "Codex's own default, chosen by OpenAI for your plan."
        }
      >
        <select
          className="field"
          value={config.codexModel}
          disabled={models === null}
          aria-label="ChatGPT model"
          onChange={(e) => {
            const next = models?.find((m) => m.slug === e.target.value);
            const keep = next && next.efforts.includes(config.codexEffort) ? config.codexEffort : "";
            update({ codexModel: e.target.value, codexEffort: keep });
          }}
        >
          <option value="">Codex default</option>
          {unknown && <option value={config.codexModel}>{config.codexModel}</option>}
          {(models ?? []).map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
      </Row>
      {efforts.length > 0 && (
        <Row label="Thinking" note="More thinking can give better Mon, but each line takes longer and uses more of your plan.">
          <select className="field" value={config.codexEffort} aria-label="Thinking" onChange={(e) => update({ codexEffort: e.target.value })}>
            <option value="">{chosen?.defaultEffort ? `Model default (${(EFFORT_LABELS[chosen.defaultEffort] ?? chosen.defaultEffort).split(",")[0]})` : "Model default"}</option>
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {EFFORT_LABELS[effort] ?? effort}
              </option>
            ))}
          </select>
        </Row>
      )}
    </>
  );
}
