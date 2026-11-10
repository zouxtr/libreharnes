import * as React from "react";
import {
  Globe,
  FileText,
  FolderOpen,
  FileCode2,
  FilePlus2,
  Wrench,
  Play,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  AlertCircle,
  X,
} from "lucide-react";
import { useHarness } from "@/lib/harness";
import { api } from "@/lib/api";
import type { ToolInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/common/Primitives";

const ICONS: Record<string, React.ElementType> = {
  web_search: Globe,
  read_html: FileText,
  list_files: FolderOpen,
  read_file: FileCode2,
  create_file: FilePlus2,
};

const LABELS: Record<string, string> = {
  web_search: "Web search",
  read_html: "Read webpage",
  list_files: "List files",
  read_file: "Read file",
  create_file: "Create file",
};

const SEARCH_LABELS: Record<string, string> = {
  tavily: "Tavily",
  brave: "Brave",
  ddg: "DuckDuckGo",
};

function defaultArgs(name: string): Record<string, string> {
  switch (name) {
    case "web_search":
      return { query: "", engine: "auto" };
    case "read_html":
      return { url: "" };
    case "read_file":
      return { path: "" };
    case "create_file":
      return { path: "", content: "" };
    default:
      return {};
  }
}

export function ToolsPage() {
  const { toast, config, refreshConfig } = useHarness();
  const [tools, setTools] = React.useState<ToolInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [args, setArgs] = React.useState<Record<string, Record<string, string>>>(
    {},
  );
  const [running, setRunning] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Record<string, string>>({});
  const [keyDrafts, setKeyDrafts] = React.useState({ brave: "", tavily: "" });
  const [savingKey, setSavingKey] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await api.getTools();
      setTools(data.tools || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (tool: ToolInfo, enabled: boolean) => {
    setTools((prev) =>
      prev.map((t) => (t.name === tool.name ? { ...t, enabled } : t)),
    );
    try {
      await api.setTool(tool.name, enabled);
    } catch (e) {
      setTools((prev) =>
        prev.map((t) => (t.name === tool.name ? { ...t, enabled: !enabled } : t)),
      );
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const runTest = async (tool: ToolInfo) => {
    const toolArgs = args[tool.name] || defaultArgs(tool.name);
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(toolArgs)) {
      if (value !== "") cleaned[key] = value;
    }
    setRunning(tool.name);
    setResults((prev) => ({ ...prev, [tool.name]: "" }));
    try {
      const res = await api.testTool(tool.name, cleaned);
      const payload = res.ok ? res.result : res.error;
      setResults((prev) => ({
        ...prev,
        [tool.name]:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 2),
      }));
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [tool.name]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setRunning(null);
    }
  };

  const priority = config?.searchPriority || ["tavily", "brave", "ddg"];

  const keyStatus = (provider: string) => {
    if (provider === "ddg") return "no key needed";
    const has =
      provider === "tavily" ? config?.hasTavilyKey : config?.hasBraveKey;
    return has ? "key set" : "no key";
  };

  const saveProviderKey = async (provider: "brave" | "tavily") => {
    const value = keyDrafts[provider].trim();
    if (!value) return;
    setSavingKey(provider);
    try {
      await api.saveConfig({ [provider + "Key"]: value });
      await refreshConfig();
      setKeyDrafts((prev) => ({ ...prev, [provider]: "" }));
      toast(`${SEARCH_LABELS[provider]} API key saved`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSavingKey(null);
    }
  };

  const moveProvider = async (index: number, dir: -1 | 1) => {
    const next = [...priority];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await api.saveConfig({ searchPriority: next });
      await refreshConfig();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const enabledCount = tools.filter((t) => t.enabled).length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
              Tools
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Built-in functions the model can call during a conversation.
            </p>
          </div>
          <span className="badge badge-solid">
            {enabledCount} of {tools.length} enabled
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11.5px] text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="rounded p-0.5 hover:bg-destructive/10"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading tools…
          </div>
        ) : (
          <div className="space-y-2">
            {tools.map((tool) => {
              const Icon = ICONS[tool.name] || Wrench;
              const isExpanded = expanded === tool.name;
              const toolArgs = args[tool.name] || defaultArgs(tool.name);
              const result = results[tool.name];
              return (
                <div
                  key={tool.name}
                  className="overflow-hidden rounded-lg border border-border bg-card"
                >
                  <div className="flex items-start gap-3 px-3.5 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12.5px] font-medium text-foreground">
                          {LABELS[tool.name] || tool.name}
                        </span>
                        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {tool.name}
                        </span>
                        {tool.enabled ? (
                          <span className="badge badge-success">Enabled</span>
                        ) : (
                          <span className="badge">Disabled</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                        {tool.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setExpanded(isExpanded ? null : tool.name);
                          if (!args[tool.name]) {
                            setArgs((prev) => ({
                              ...prev,
                              [tool.name]: defaultArgs(tool.name),
                            }));
                          }
                        }}
                        className={cn(
                          "btn btn-ghost btn-sm",
                          isExpanded && "bg-accent text-foreground",
                        )}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        Test
                      </button>
                      <Switch
                        checked={tool.enabled}
                        onCheckedChange={(checked) => void toggle(tool, checked)}
                        label={`Enable ${tool.name}`}
                      />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border bg-background/40 px-3.5 py-3">
                      <div className="space-y-2">
                        {tool.name === "web_search" && (
                          <>
                            <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                              <div>
                                <label className="label">Query</label>
                                <input
                                  value={toolArgs.query || ""}
                                  onChange={(e) =>
                                    setArgs((prev) => ({
                                      ...prev,
                                      [tool.name]: {
                                        ...toolArgs,
                                        query: e.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="llama.cpp release notes"
                                  className="input mt-1"
                                />
                              </div>
                              <div>
                                <label className="label">Engine</label>
                                <select
                                  value={toolArgs.engine || "auto"}
                                  onChange={(e) =>
                                    setArgs((prev) => ({
                                      ...prev,
                                      [tool.name]: {
                                        ...toolArgs,
                                        engine: e.target.value,
                                      },
                                    }))
                                  }
                                  className="input mt-1"
                                >
                                  <option value="auto">Automatic</option>
                                  <option value="ddg">DuckDuckGo</option>
                                  <option value="brave">Brave</option>
                                  <option value="tavily">Tavily</option>
                                </select>
                              </div>
                            </div>

                            <div>
                              <label className="label">Provider priority</label>
                              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                                {SEARCH_LABELS[priority[0]] || priority[0]} is used
                                first; the next provider is tried when it has no
                                key, fails or returns nothing.
                              </p>
                              <div className="mt-1.5 space-y-1">
                                {priority.map((name, i) => (
                                  <div
                                    key={name}
                                    className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
                                  >
                                    <span className="w-3 text-[11px] text-muted-foreground">
                                      {i + 1}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                                      {SEARCH_LABELS[name] || name}
                                    </span>
                                    <span className="badge">{keyStatus(name)}</span>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-icon h-6 w-6"
                                      onClick={() => void moveProvider(i, -1)}
                                      disabled={i === 0}
                                      aria-label={`Move ${SEARCH_LABELS[name] || name} up`}
                                    >
                                      <ChevronUp className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-icon h-6 w-6"
                                      onClick={() => void moveProvider(i, 1)}
                                      disabled={i === priority.length - 1}
                                      aria-label={`Move ${SEARCH_LABELS[name] || name} down`}
                                    >
                                      <ChevronDown className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2 pt-1">
                              <div>
                                <label className="label">Brave API key</label>
                                <div className="flex gap-2">
                                  <input
                                    type="password"
                                    value={keyDrafts.brave}
                                    onChange={(e) =>
                                      setKeyDrafts((prev) => ({
                                        ...prev,
                                        brave: e.target.value,
                                      }))
                                    }
                                    placeholder={
                                      config?.hasBraveKey ? "••••••••" : "…"
                                    }
                                    className="input flex-1"
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() => void saveProviderKey("brave")}
                                    disabled={
                                      !keyDrafts.brave.trim() ||
                                      savingKey !== null
                                    }
                                  >
                                    {savingKey === "brave" ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      "Save key"
                                    )}
                                  </button>
                                </div>
                                <p className="mt-1 text-[11.5px] text-muted-foreground">
                                  {config?.hasBraveKey
                                    ? "A key is stored in config.json. Type a new one to replace it."
                                    : "Optional. Get a key at brave.com/search/api."}
                                </p>
                              </div>
                              <div>
                                <label className="label">Tavily API key</label>
                                <div className="flex gap-2">
                                  <input
                                    type="password"
                                    value={keyDrafts.tavily}
                                    onChange={(e) =>
                                      setKeyDrafts((prev) => ({
                                        ...prev,
                                        tavily: e.target.value,
                                      }))
                                    }
                                    placeholder={
                                      config?.hasTavilyKey ? "••••••••" : "tvly-…"
                                    }
                                    className="input flex-1"
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() => void saveProviderKey("tavily")}
                                    disabled={
                                      !keyDrafts.tavily.trim() ||
                                      savingKey !== null
                                    }
                                  >
                                    {savingKey === "tavily" ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      "Save key"
                                    )}
                                  </button>
                                </div>
                                <p className="mt-1 text-[11.5px] text-muted-foreground">
                                  {config?.hasTavilyKey
                                    ? "A key is stored in config.json. Type a new one to replace it."
                                    : "Optional. Stored in config.json and sent to api.tavily.com. Get a key at app.tavily.com."}
                                </p>
                              </div>
                            </div>
                          </>
                        )}

                        {tool.name === "read_html" && (
                          <div>
                            <label className="label">URL</label>
                            <input
                              value={toolArgs.url || ""}
                              onChange={(e) =>
                                setArgs((prev) => ({
                                  ...prev,
                                  [tool.name]: {
                                    ...toolArgs,
                                    url: e.target.value,
                                  },
                                }))
                              }
                              placeholder="https://example.com"
                              className="input mt-1"
                            />
                          </div>
                        )}

                        {tool.name === "read_file" && (
                          <div>
                            <label className="label">Path (relative to sandbox)</label>
                            <input
                              value={toolArgs.path || ""}
                              onChange={(e) =>
                                setArgs((prev) => ({
                                  ...prev,
                                  [tool.name]: {
                                    ...toolArgs,
                                    path: e.target.value,
                                  },
                                }))
                              }
                              placeholder="notes.txt"
                              className="input mt-1"
                            />
                          </div>
                        )}

                        {tool.name === "create_file" && (
                          <div className="space-y-2">
                            <div>
                              <label className="label">
                                Path (relative to sandbox)
                              </label>
                              <input
                                value={toolArgs.path || ""}
                                onChange={(e) =>
                                  setArgs((prev) => ({
                                    ...prev,
                                    [tool.name]: {
                                      ...toolArgs,
                                      path: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="hello.txt"
                                className="input mt-1"
                              />
                            </div>
                            <div>
                              <label className="label">Content</label>
                              <textarea
                                value={toolArgs.content || ""}
                                onChange={(e) =>
                                  setArgs((prev) => ({
                                    ...prev,
                                    [tool.name]: {
                                      ...toolArgs,
                                      content: e.target.value,
                                    },
                                  }))
                                }
                                rows={3}
                                placeholder="Hello from LibreHarnes"
                                className="textarea mt-1"
                              />
                            </div>
                          </div>
                        )}

                        {tool.name === "list_files" && (
                          <p className="text-[11.5px] text-muted-foreground">
                            This tool takes no arguments.
                          </p>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => void runTest(tool)}
                            disabled={running === tool.name}
                          >
                            {running === tool.name ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            Run test
                          </button>
                          {result && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                setResults((prev) => ({
                                  ...prev,
                                  [tool.name]: "",
                                }))
                              }
                            >
                              Clear result
                            </button>
                          )}
                        </div>

                        {result && (
                          <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-card p-2.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                            {result}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && tools.length > 0 && (
          <details className="mt-4 rounded-lg border border-border bg-card">
            <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[11.5px] text-muted-foreground hover:text-foreground">
              View active tool schema (sent to the model)
            </summary>
            <pre className="max-h-72 overflow-auto border-t border-border p-3 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
              {JSON.stringify(
                {
                  tools: tools
                    .filter((t) => t.enabled)
                    .map((t) => ({
                      name: t.name,
                      description: t.description,
                      parameters: t.parameters,
                    })),
                },
                null,
                2,
              )}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
