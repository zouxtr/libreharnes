import * as React from "react";
import {
  Sun,
  Moon,
  Monitor,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Server,
  KeyRound,
  SlidersHorizontal,
  Cpu,
  Check,
  AlertCircle,
  Loader2,
  Square,
  Palette,
} from "lucide-react";
import { useHarness } from "@/lib/harness";
import { api } from "@/lib/api";
import type { Config, Endpoint, ThinkingEffort } from "@/lib/types";
import { cn, shortModelName } from "@/lib/utils";

interface FormState {
  contextSize: string;
  threads: string;
  llamaPort: string;
  temperature: string;
  topP: string;
  maxTokens: string;
  thinkingEffort: ThinkingEffort;
  systemPrompt: string;
  localApiKey: string;
  clearLocalKey: boolean;
  activeEndpoint: string;
  endpoints: Endpoint[];
}

function fromConfig(config: Config): FormState {
  return {
    contextSize: String(config.contextSize ?? 2048),
    threads: String(config.threads ?? 4),
    llamaPort: String(config.llamaPort ?? 8080),
    temperature: String(config.temperature ?? 0.7),
    topP: String(config.topP ?? 0.95),
    maxTokens: String(config.maxTokens ?? 1024),
    thinkingEffort: config.thinkingEffort || "default",
    systemPrompt: config.systemPrompt || "",
    localApiKey: "",
    clearLocalKey: false,
    activeEndpoint: config.activeEndpoint || "local",
    endpoints: config.endpoints || [],
  };
}

const EFFORTS: { value: ThinkingEffort; label: string; hint: string }[] = [
  { value: "default", label: "Default", hint: "Model default" },
  { value: "low", label: "Low", hint: "Faster" },
  { value: "high", label: "High", hint: "More reasoning" },
  { value: "disabled", label: "Off", hint: "No thinking" },
];

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[10.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SettingsPage() {
  const {
    config,
    theme,
    setTheme,
    refreshConfig,
    toast,
  } = useHarness();
  const [form, setForm] = React.useState<FormState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const initialized = React.useRef(false);

  React.useEffect(() => {
    if (config && !initialized.current) {
      setForm(fromConfig(config));
      initialized.current = true;
    }
  }, [config]);

  if (!form || !config) {
    return (
      <div className="flex h-full items-center justify-center">
        {error ? (
          <p className="max-w-sm text-center text-[12.5px] text-destructive">{error}</p>
        ) : (
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading settings…
          </div>
        )}
      </div>
    );
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {
        contextSize: Number(form.contextSize) || 2048,
        threads: Number(form.threads) || 4,
        llamaPort: Number(form.llamaPort) || 8080,
        temperature: Number(form.temperature) || 0.7,
        topP: Number(form.topP) || 0.95,
        maxTokens: Number(form.maxTokens) || 1024,
        thinkingEffort: form.thinkingEffort,
        systemPrompt: form.systemPrompt,
        endpoints: form.endpoints,
        activeEndpoint: form.activeEndpoint,
      };
      if (form.clearLocalKey) patch.localApiKey = "";
      else if (form.localApiKey.trim()) patch.localApiKey = form.localApiKey.trim();

      await api.saveConfig(patch);
      await refreshConfig();
      setForm((prev) => (prev ? { ...prev, localApiKey: "", clearLocalKey: false } : prev));
      toast("Settings saved", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setForm(fromConfig(config));
    toast("Form reset — click Save to apply", "info");
  };

  const handleUnload = async () => {
    setBusy(true);
    try {
      await api.unloadModel();
      await refreshConfig();
      toast("Model unloaded", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const addEndpoint = () => {
    const name = `endpoint-${form.endpoints.length + 1}`;
    update("endpoints", [
      ...form.endpoints,
      { name, baseUrl: "https://openrouter.ai/api", key: "", type: "external" },
    ]);
  };

  const updateEndpoint = (index: number, patch: Partial<Endpoint>) => {
    update(
      "endpoints",
      form.endpoints.map((ep, i) => (i === index ? { ...ep, ...patch } : ep)),
    );
  };

  const removeEndpoint = (index: number) => {
    const removed = form.endpoints[index];
    update(
      "endpoints",
      form.endpoints.filter((_, i) => i !== index),
    );
    if (removed && form.activeEndpoint === removed.name) {
      update("activeEndpoint", "local");
    }
  };

  const themeOptions: { value: "light" | "dark" | "system"; label: string; icon: React.ElementType }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
          Settings
        </h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Runtime, appearance, and API configuration.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-3xl space-y-3">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11.5px] text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 whitespace-pre-wrap break-words">{error}</span>
            </div>
          )}

          <Section
            icon={Palette}
            title="Appearance"
            description="Choose how LibreHarnes looks. The change applies immediately."
          >
            <div className="flex flex-wrap gap-2">
              {themeOptions.map((opt) => {
                const Icon = opt.icon;
                const active = theme === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTheme(opt.value)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] transition-colors",
                      active
                        ? "border-foreground/30 bg-secondary text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {opt.label}
                    {active && <Check className="h-3 w-3 text-success" />}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section
            icon={SlidersHorizontal}
            title="Chat defaults"
            description="Sampling and reasoning defaults for every conversation."
          >
            <div className="space-y-3">
              <div>
                <label className="label">Thinking effort</label>
                <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {EFFORTS.map((e) => (
                    <button
                      key={e.value}
                      type="button"
                      onClick={() => update("thinkingEffort", e.value)}
                      className={cn(
                        "rounded-md border px-2 py-1.5 text-left transition-colors",
                        form.thinkingEffort === e.value
                          ? "border-foreground/30 bg-secondary"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      <span className="block text-[11.5px] font-medium text-foreground">
                        {e.label}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {e.hint}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  Sent as reasoning effort / enable_thinking where supported. Not every model honours it.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Temperature" hint="0 = deterministic, 2 = chaotic">
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="2"
                    value={form.temperature}
                    onChange={(e) => update("temperature", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Top P" hint="Nucleus sampling threshold">
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={form.topP}
                    onChange={(e) => update("topP", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Max tokens" hint="Maximum response length">
                  <input
                    type="number"
                    step="64"
                    min="64"
                    value={form.maxTokens}
                    onChange={(e) => update("maxTokens", e.target.value)}
                    className="input"
                  />
                </Field>
              </div>

              <Field
                label="System prompt"
                hint="Optional. Prepended to every conversation."
              >
                <textarea
                  value={form.systemPrompt}
                  onChange={(e) => update("systemPrompt", e.target.value)}
                  rows={2}
                  placeholder="You are a concise, helpful assistant."
                  className="textarea"
                />
              </Field>
            </div>
          </Section>

          <Section
            icon={Cpu}
            title="Local runtime"
            description="Settings used when llama.cpp loads a GGUF model on your CPU."
          >
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Context size" hint="Tokens per conversation">
                  <input
                    type="number"
                    step="512"
                    min="512"
                    value={form.contextSize}
                    onChange={(e) => update("contextSize", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="CPU threads" hint={`Detected ${config.threads} configured`}>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={form.threads}
                    onChange={(e) => update("threads", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="llama.cpp port" hint="Internal server port">
                  <input
                    type="number"
                    step="1"
                    min="1024"
                    value={form.llamaPort}
                    onChange={(e) => update("llamaPort", e.target.value)}
                    className="input"
                  />
                </Field>
              </div>

              <div className="rounded-md border border-border bg-background px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      config.loaded
                        ? "bg-success"
                        : config.llamaState === "starting"
                          ? "bg-warning"
                          : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="font-medium text-foreground">
                    {config.loaded
                      ? `Loaded: ${shortModelName(config.model)}`
                      : config.llamaState === "starting"
                        ? "Loading model…"
                        : config.llamaState === "error"
                          ? "Load error"
                          : "No model loaded"}
                  </span>
                  {config.loaded && (
                    <button
                      type="button"
                      onClick={() => void handleUnload()}
                      disabled={busy}
                      className="btn btn-ghost btn-sm ml-auto"
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Square className="h-3 w-3" />
                      )}
                      Unload
                    </button>
                  )}
                </div>
                {config.llamaError && (
                  <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-destructive">
                    {config.llamaError}
                  </pre>
                )}
              </div>

              <Field label="llama-server binary" hint="Built from llama.cpp source">
                <input
                  value={config.llamaServer}
                  readOnly
                  className="input font-mono text-[11px] text-muted-foreground"
                />
              </Field>
            </div>
          </Section>

          <Section
            icon={KeyRound}
            title="API access"
            description="Use a local API key or connect any OpenAI-compatible endpoint."
          >
            <div className="space-y-3">
              <Field
                label="Local llama-server API key"
                hint={
                  config.localApiKey
                    ? "A key is stored. Type a new one to replace it."
                    : "Optional. Protects your local llama-server."
                }
              >
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={form.localApiKey}
                    onChange={(e) => update("localApiKey", e.target.value)}
                    placeholder={config.localApiKey ? "••••••••" : "Optional key"}
                    className="input flex-1"
                  />
                  {config.localApiKey && (
                    <button
                      type="button"
                      onClick={() => update("clearLocalKey", !form.clearLocalKey)}
                      className={cn(
                        "btn btn-sm shrink-0",
                        form.clearLocalKey
                          ? "btn-danger"
                          : "btn-outline",
                      )}
                    >
                      {form.clearLocalKey ? "Will clear" : "Clear key"}
                    </button>
                  )}
                </div>
              </Field>

              <div>
                <div className="flex items-center justify-between">
                  <label className="label">External endpoints</label>
                  <button
                    type="button"
                    onClick={addEndpoint}
                    className="btn btn-outline btn-sm"
                  >
                    <Plus className="h-3 w-3" />
                    Add endpoint
                  </button>
                </div>
                {form.endpoints.length === 0 ? (
                  <p className="mt-1.5 rounded-md border border-dashed border-border px-2.5 py-2 text-[11.5px] text-muted-foreground">
                    No external endpoints. Add OpenRouter, Together, or any OpenAI-compatible API.
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-2">
                    {form.endpoints.map((ep, i) => (
                      <div
                        key={`${ep.name}-${i}`}
                        className="rounded-md border border-border bg-background p-2.5"
                      >
                        <div className="grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto]">
                          <input
                            value={ep.name}
                            onChange={(e) =>
                              updateEndpoint(i, { name: e.target.value })
                            }
                            placeholder="name"
                            className="input h-8 text-[11.5px]"
                          />
                          <input
                            value={ep.baseUrl}
                            onChange={(e) =>
                              updateEndpoint(i, { baseUrl: e.target.value })
                            }
                            placeholder="https://openrouter.ai/api"
                            className="input h-8 text-[11.5px]"
                          />
                          <input
                            type="password"
                            value={ep.key}
                            onChange={(e) =>
                              updateEndpoint(i, { key: e.target.value })
                            }
                            placeholder="API key"
                            className="input h-8 text-[11.5px]"
                          />
                          <button
                            type="button"
                            onClick={() => removeEndpoint(i)}
                            className="btn btn-ghost btn-icon h-8 w-8 text-muted-foreground hover:text-destructive"
                            aria-label="Remove endpoint"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Field
                label="Active backend"
                hint="Local uses llama.cpp. External forwards to the selected endpoint."
              >
                <select
                  value={form.activeEndpoint}
                  onChange={(e) => update("activeEndpoint", e.target.value)}
                  className="input"
                >
                  <option value="local">Local (llama.cpp)</option>
                  {form.endpoints.map((ep) => (
                    <option key={ep.name} value={ep.name}>
                      {ep.name} — {ep.baseUrl}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <div className="flex items-center justify-between gap-2 pb-2 pt-1">
            <button
              type="button"
              onClick={handleReset}
              className="btn btn-ghost btn-md"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset form
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="btn btn-primary btn-md"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>

          <p className="pb-4 text-center text-[10.5px] text-muted-foreground">
            <Server className="mr-1 inline h-3 w-3" />
            Backend: {config.host}:{config.port} · llama.cpp: {config.host}:{config.llamaPort}
          </p>
        </div>
      </div>
    </div>
  );
}
