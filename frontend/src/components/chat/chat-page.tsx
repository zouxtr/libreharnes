import * as React from "react";
import {
  ArrowUp,
  Square,
  ChevronDown,
  RefreshCw,
  Trash2,
  Boxes,
  Check,
  Loader2,
  Sparkles,
  AlertCircle,
  X,
} from "lucide-react";
import { useHarness } from "@/lib/harness";
import { api } from "@/lib/api";
import type { ChatMessageRecord, ThinkingEffort } from "@/lib/types";
import { cn, shortModelName } from "@/lib/utils";
import { useClickOutside } from "@/lib/use-click-outside";
import { ChatMessage } from "./chat-message";

interface ChatPageProps {
  chatId: string | null;
  resetNonce: number;
  onChatCreated: (id: string) => void;
  onOpenModels: () => void;
}

const EFFORTS: { value: ThinkingEffort; label: string; hint: string }[] = [
  { value: "default", label: "Default", hint: "Use the model's own default" },
  { value: "low", label: "Low", hint: "Faster, less reasoning" },
  { value: "high", label: "High", hint: "Slower, more reasoning" },
  { value: "disabled", label: "Off", hint: "Disable thinking if supported" },
];

const SUGGESTIONS = [
  "Explain what a GGUF file is in simple terms.",
  "Write a short Python script that lists files in a folder.",
  "Search the web for the latest llama.cpp release notes.",
];

export function ChatPage({
  chatId,
  resetNonce,
  onChatCreated,
  onOpenModels,
}: ChatPageProps) {
  const {
    config,
    models,
    refreshConfig,
    refreshChats,
    toast,
  } = useHarness();

  const [messages, setMessages] = React.useState<ChatMessageRecord[]>([]);
  const [input, setInput] = React.useState("");
  const [title, setTitle] = React.useState("New chat");
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [toolLabel, setToolLabel] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingChat, setLoadingChat] = React.useState(false);
  const [loadingModel, setLoadingModel] = React.useState<string | null>(null);
  const [modelMenu, setModelMenu] = React.useState(false);
  const [effortMenu, setEffortMenu] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const justCreatedRef = React.useRef<string | null>(null);

  const modelMenuRef = useClickOutside<HTMLDivElement>(
    () => setModelMenu(false),
    modelMenu,
  );
  const effortMenuRef = useClickOutside<HTMLDivElement>(
    () => setEffortMenu(false),
    effortMenu,
  );

  // Load the selected conversation.
  React.useEffect(() => {
    if (chatId && justCreatedRef.current === chatId) {
      justCreatedRef.current = null;
      return;
    }
    if (!chatId) {
      setMessages([]);
      setTitle("New chat");
      setActiveId(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoadingChat(true);
    api
      .getChat(chatId)
      .then(({ chat }) => {
        if (cancelled) return;
        setMessages(
          (chat.messages || []).filter(
            (m) => m.role === "user" || m.role === "assistant",
          ),
        );
        setTitle(chat.title || "Chat");
        setActiveId(chat.id);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingChat(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, resetNonce]);

  // Scroll to the newest message.
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending, toolLabel]);

  // Auto-grow the composer.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  const loadedModel = models.find((m) => m.loaded);
  const effort = config?.thinkingEffort || "default";
  const effortLabel =
    EFFORTS.find((e) => e.value === effort)?.label || "Default";

  const handleSelectModel = async (name: string) => {
    setModelMenu(false);
    setLoadingModel(name);
    setError(null);
    try {
      await api.loadModel(name);
      await refreshConfig();
      toast(`Loaded ${shortModelName(name)}`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast("Could not load model", "error");
    } finally {
      setLoadingModel(null);
    }
  };

  const handleUnload = async () => {
    setModelMenu(false);
    setLoadingModel("__unload__");
    try {
      await api.unloadModel();
      await refreshConfig();
      toast("Model unloaded", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModel(null);
    }
  };

  const handleEffort = async (value: ThinkingEffort) => {
    setEffortMenu(false);
    try {
      await api.saveConfig({ thinkingEffort: value });
      await refreshConfig();
      toast(`Thinking effort: ${value}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const runCompletion = async (history: ChatMessageRecord[]) => {
    if (!config?.model) {
      setError("Select a local model first, or download one from Models.");
      setModelMenu(true);
      return;
    }
    setError(null);
    setMessages([...history, { role: "assistant", content: "" }]);
    setSending(true);
    setToolLabel(null);

    const controller = new AbortController();
    abortRef.current = controller;
    let chatIdToUse = activeId;
    let assistant = "";
    let reasoning = "";
    const modelName = shortModelName(config.model);

    try {
      if (!config.loaded) {
        setToolLabel("Loading model into memory…");
        await api.loadModel(shortModelName(config.model));
        await refreshConfig();
        setToolLabel(null);
      }

      if (!chatIdToUse) {
        const lastUser = [...history].reverse().find((m) => m.role === "user");
        const newTitle = (lastUser?.content || "New chat").slice(0, 60);
        const created = await api.saveChat({ title: newTitle, messages: [] });
        chatIdToUse = created.chat.id;
        justCreatedRef.current = chatIdToUse;
        setActiveId(chatIdToUse);
        setTitle(newTitle);
        onChatCreated(chatIdToUse);
      }

      const res = await api.chat(
        history.map((m) => ({ role: m.role, content: m.content })),
        {
          stream: true,
          chatId: chatIdToUse,
          signal: controller.signal,
          thinkingEffort: config.thinkingEffort,
        },
      );

      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      if (!res.body) throw new Error("The backend returned no response stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let json: {
            error?: string;
            type?: string;
            name?: string;
            content?: string;
            choices?: { delta?: { content?: string } }[];
          };
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          if (json.error) throw new Error(json.error);
          if (json.type === "tool") {
            setToolLabel(`Running ${json.name || "tool"}…`);
            continue;
          }
          if (json.type === "tool_result") {
            setToolLabel(null);
            continue;
          }
          if (json.type === "reasoning" && json.content) {
            reasoning += json.content;
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = {
                role: "assistant",
                content: assistant,
                reasoning,
                model: modelName,
              };
              return copy;
            });
            continue;
          }
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            assistant += delta;
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = {
                role: "assistant",
                content: assistant,
                reasoning: reasoning || undefined,
                model: modelName,
              };
              return copy;
            });
          }
        }
      }

      if (!assistant) {
        assistant = "(The model returned an empty response.)";
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: assistant,
            reasoning: reasoning || undefined,
            model: modelName,
          };
          return copy;
        });
      }

      await api.updateChat(chatIdToUse, {
        title,
        messages: [
          ...history,
          {
            role: "assistant",
            content: assistant,
            reasoning: reasoning || undefined,
            model: modelName,
            createdAt: Date.now(),
          },
        ],
      });
      await refreshChats();
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        setMessages((prev) => {
          const copy = [...prev];
          if (copy.length && copy[copy.length - 1].role === "assistant" && !copy[copy.length - 1].content) {
            copy.pop();
          }
          return copy;
        });
      } else {
        setError(err.message);
        setMessages((prev) => {
          const copy = [...prev];
          if (copy.length && copy[copy.length - 1].role === "assistant" && !copy[copy.length - 1].content) {
            copy.pop();
          }
          return copy;
        });
      }
    } finally {
      setSending(false);
      setToolLabel(null);
      abortRef.current = null;
      void refreshConfig();
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const history: ChatMessageRecord[] = [
      ...messages.filter((m) => m.role === "user" || m.role === "assistant"),
      { role: "user", content: text },
    ];
    setInput("");
    await runCompletion(history);
  };

  const handleRegenerate = async () => {
    if (sending) return;
    const lastUserIndex = [...messages]
      .map((m, i) => ({ m, i }))
      .reverse()
      .find(({ m }) => m.role === "user")?.i;
    if (lastUserIndex === undefined) return;
    const history = messages.slice(0, lastUserIndex + 1);
    await runCompletion(history);
  };

  const handleClear = async () => {
    setMessages([]);
    setError(null);
    setTitle("New chat");
    if (activeId) {
      try {
        await api.updateChat(activeId, { title: "New chat", messages: [] });
        await refreshChats();
      } catch {
        /* ignore */
      }
    }
    toast("Conversation cleared", "success");
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-foreground">
            {title}
          </span>
          {sending && (
            <span className="badge badge-solid shrink-0">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Generating
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className="relative" ref={modelMenuRef}>
            <button
              type="button"
              onClick={() => setModelMenu((v) => !v)}
              className="btn btn-outline btn-sm max-w-[190px] gap-1.5"
              title="Select local model"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  config?.loaded ? "bg-success" : "bg-muted-foreground/40",
                )}
              />
              <span className="truncate">
                {loadingModel && loadingModel !== "__unload__"
                  ? "Loading…"
                  : shortModelName(config?.model) || "Select model"}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
            </button>
            {modelMenu && (
              <div className="menu absolute right-0 top-full mt-1 w-[280px] animate-slide-up">
                {models.length === 0 ? (
                  <div className="px-2 py-3 text-[12px] text-muted-foreground">
                    No local models yet.
                  </div>
                ) : (
                  models.map((m) => (
                    <div
                      key={m.name}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => void handleSelectModel(m.name)}
                        disabled={!!loadingModel}
                      >
                        <span className="block truncate text-[12px] text-foreground">
                          {shortModelName(m.name)}
                        </span>
                        <span className="text-[10.5px] text-muted-foreground">
                          {m.sizeStr}
                          {m.loaded ? " · loaded" : ""}
                        </span>
                      </button>
                      {m.loaded ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {loadingModel === m.name ? "…" : "Load"}
                        </span>
                      )}
                    </div>
                  ))
                )}
                {config?.loaded && (
                  <>
                    <div className="menu-sep" />
                    <button
                      type="button"
                      className="menu-item text-muted-foreground"
                      onClick={() => void handleUnload()}
                      disabled={!!loadingModel}
                    >
                      {loadingModel === "__unload__"
                        ? "Unloading…"
                        : `Unload ${loadedModel ? shortModelName(loadedModel.name) : "model"}`}
                    </button>
                  </>
                )}
                <div className="menu-sep" />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setModelMenu(false);
                    onOpenModels();
                  }}
                >
                  <Boxes className="h-3.5 w-3.5" />
                  Browse models…
                </button>
              </div>
            )}
          </div>

          <div className="relative" ref={effortMenuRef}>
            <button
              type="button"
              onClick={() => setEffortMenu((v) => !v)}
              className="btn btn-ghost btn-sm hidden gap-1.5 sm:flex"
              title="Thinking effort"
            >
              <Sparkles className="h-3 w-3" />
              {effortLabel}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
            {effortMenu && (
              <div className="menu absolute right-0 top-full mt-1 w-[220px] animate-slide-up">
                {EFFORTS.map((e) => (
                  <button
                    key={e.value}
                    type="button"
                    className="menu-item justify-between"
                    onClick={() => void handleEffort(e.value)}
                  >
                    <span>
                      <span className="block text-[12px]">{e.label}</span>
                      <span className="block text-[10.5px] text-muted-foreground">
                        {e.hint}
                      </span>
                    </span>
                    {effort === e.value && (
                      <Check className="h-3.5 w-3.5 text-success" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleRegenerate()}
            disabled={sending || !messages.some((m) => m.role === "user")}
            className="btn btn-ghost btn-icon"
            title="Regenerate last response"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={sending || messages.length === 0}
            className="btn btn-ghost btn-icon"
            title="Clear conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {loadingChat ? (
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading conversation…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-[12px] font-bold tracking-tight text-foreground">
                LH
              </div>
              <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
                How can I help you today?
              </h2>
              <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                {config?.model
                  ? `${shortModelName(config.model)} is ${config.loaded ? "loaded and ready" : "selected — it will load on your first message"}.`
                  : "Download a GGUF model from Models, then start chatting locally on your CPU."}
              </p>
              {!config?.model && (
                <button
                  type="button"
                  onClick={onOpenModels}
                  className="btn btn-primary btn-md mt-4"
                >
                  <Boxes className="h-3.5 w-3.5" />
                  Browse models
                </button>
              )}
              <div className="mt-6 grid w-full max-w-lg gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setInput(s);
                      textareaRef.current?.focus();
                    }}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <ChatMessage
                key={`${i}-${m.role}`}
                role={m.role}
                content={m.content}
                reasoning={m.reasoning}
                model={m.model}
                streaming={
                  sending && i === messages.length - 1 && m.role === "assistant"
                }
                toolLabel={
                  i === messages.length - 1 && m.role === "assistant"
                    ? toolLabel || undefined
                    : undefined
                }
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          {error && (
            <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11.5px] text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 whitespace-pre-wrap break-words">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="rounded p-0.5 hover:bg-destructive/10"
                aria-label="Dismiss error"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card transition-colors focus-within:border-ring">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={
                config?.model
                  ? "Send a message…"
                  : "Select or download a model to start…"
              }
              className="max-h-[200px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    config?.loaded
                      ? "bg-success"
                      : config?.model
                        ? "bg-warning"
                        : "bg-muted-foreground/40",
                  )}
                />
                <span className="truncate">
                  {shortModelName(config?.model) || "No model"}
                </span>
                <span className="opacity-50">·</span>
                <span className="shrink-0">{effortLabel}</span>
              </div>
              {sending ? (
                <button
                  type="button"
                  onClick={stop}
                  className="btn btn-secondary btn-icon h-7 w-7"
                  title="Stop generating"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!input.trim()}
                  className="btn btn-primary btn-icon h-7 w-7"
                  title="Send"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground/70">
            Enter to send · Shift+Enter for a new line · Everything runs locally
          </p>
        </div>
      </div>
    </div>
  );
}
