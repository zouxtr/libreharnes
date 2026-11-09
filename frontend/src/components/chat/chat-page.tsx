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
  Paperclip,
  FileText,
  Star,
  Eye,
} from "lucide-react";
import { useHarness } from "@/lib/harness";
import { api } from "@/lib/api";
import type {
  ChatAttachment,
  ChatMessageRecord,
  ChatStats,
  ChatToolEvent,
  ThinkingEffort,
} from "@/lib/types";
import { cn, formatBytes, shortModelName } from "@/lib/utils";
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

/** Turn attached text/binary files into context the model can actually read. */
const MAX_INLINE_FILE_CHARS = 20000;
const MAX_IMAGE_DIM = 1400;

function attachmentUrl(attachment: ChatAttachment): string {
  return (
    attachment.url ||
    `/api/uploads/${encodeURIComponent(attachment.name)}`
  );
}

function attachmentContext(attachments?: ChatAttachment[]): string {
  if (!attachments || attachments.length === 0) return "";
  // Images are sent as native vision content parts, not as inline text.
  return attachments
    .filter((attachment) => attachment.kind !== "image")
    .map((attachment) => {
      const header = `[Attached file: ${attachment.name} (${attachment.path})]`;
      if (attachment.text) {
        const truncated = attachment.text.length > MAX_INLINE_FILE_CHARS;
        const body = truncated
          ? `${attachment.text.slice(0, MAX_INLINE_FILE_CHARS)}\n… (file truncated)`
          : attachment.text;
        return `${header}\n\`\`\`\n${body}\n\`\`\``;
      }
      return `${header}\nBinary file saved at ${attachment.path}. Use the read_file tool if you need its contents.`;
    })
    .join("\n\n");
}

type ApiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ApiMessage {
  role: string;
  content: string | ApiContentPart[];
}

async function toApiMessage(message: ChatMessageRecord): Promise<ApiMessage> {
  const images = (message.attachments || []).filter(
    (attachment) => attachment.kind === "image",
  );
  const extra =
    message.role === "user" ? attachmentContext(message.attachments) : "";
  const text = extra ? `${message.content}\n\n${extra}` : message.content;

  if (images.length === 0) {
    return { role: message.role, content: text };
  }

  const parts: ApiContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });
  for (const image of images) {
    try {
      const dataUrl = await api.getUploadDataUrl(attachmentUrl(image));
      if (dataUrl) {
        parts.push({ type: "image_url", image_url: { url: dataUrl } });
      }
    } catch {
      // If an image cannot be read, keep the text so the request still works.
    }
  }
  if (parts.length === 0) return { role: message.role, content: text };
  return { role: message.role, content: parts };
}

async function buildApiMessages(
  history: ChatMessageRecord[],
): Promise<ApiMessage[]> {
  return Promise.all(history.map((message) => toApiMessage(message)));
}

/**
 * Downscale large photos before uploading. Vision models resize images
 * internally anyway, and smaller images keep requests fast and fit VRAM.
 */
async function prepareUpload(file: File): Promise<File> {
  if (
    !file.type.startsWith("image/") ||
    file.type === "image/svg+xml" ||
    file.type === "image/gif"
  ) {
    return file;
  }
  try {
    if (typeof createImageBitmap !== "function") return file;
    const bitmap = await createImageBitmap(file);
    const largest = Math.max(bitmap.width, bitmap.height);
    if (largest <= MAX_IMAGE_DIM && file.size <= 1.5 * 1024 * 1024) {
      bitmap.close?.();
      return file;
    }
    const scale = Math.min(1, MAX_IMAGE_DIM / largest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Use the first five words of the first message as the chat title. */
function titleFromMessage(message?: ChatMessageRecord): string {
  const text =
    (message?.content || "").trim() ||
    (message?.attachments || []).map((a) => a.name).join(" ");
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "New chat";
  return words.slice(0, 5).join(" ").slice(0, 60).trimEnd();
}

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
  const [attachments, setAttachments] = React.useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [showThinking] = React.useState(() => {
    try {
      return localStorage.getItem("lh.showThinking") === "1";
    } catch {
      return false;
    }
  });

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
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
    setAttachments([]);
    if (chatId && justCreatedRef.current === chatId) {
      justCreatedRef.current = null;
      return;
    }
    // Selecting a different conversation stops any response still streaming
    // into the previous one. Switching pages does not change chatId, so the
    // chat keeps running in the background.
    abortRef.current?.abort();
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
        const allMessages = chat.messages || [];
        setMessages(
          allMessages.filter(
            (m) => m.role === "user" || m.role === "assistant",
          ),
        );
        const storedTitle =
          chat.title && chat.title !== "New chat" && chat.title !== "Chat"
            ? chat.title
            : "";
        const resolvedTitle =
          storedTitle ||
          titleFromMessage(allMessages.find((m) => m.role === "user"));
        setTitle(resolvedTitle);
        if (resolvedTitle !== chat.title && resolvedTitle !== "New chat") {
          void api
            .updateChat(chat.id, { title: resolvedTitle })
            .catch(() => {
              /* repair is best-effort */
            });
        }
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
  const orderedModels = React.useMemo(
    () =>
      [...models].sort(
        (a, b) =>
          Number(b.starred) - Number(a.starred) ||
          a.name.localeCompare(b.name),
      ),
    [models],
  );
  const effort = config?.thinkingEffort || "default";
  const effortLabel =
    EFFORTS.find((e) => e.value === effort)?.label || "Default";
  const activeEndpoint = config?.endpoints?.find(
    (e) => e.name === config.activeEndpoint,
  );
  const usingExternal = !!activeEndpoint && config?.activeEndpoint !== "local";
  const activeLabel = usingExternal
    ? activeEndpoint.model || activeEndpoint.name
    : shortModelName(config?.model);

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

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: ChatAttachment[] = [];
      for (const original of Array.from(files)) {
        const file = await prepareUpload(original);
        const result = await api.uploadFile(file);
        uploaded.push(result.file);
      }
      setAttachments((prev) => [...prev, ...uploaded]);
      toast(
        `Attached ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}`,
        "success",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const runCompletion = async (history: ChatMessageRecord[]) => {
    if (!usingExternal && !config?.model) {
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
    let chatTitle = title;
    const firstUser = history.find((m) => m.role === "user");
    if ((!chatTitle || chatTitle === "New chat") && firstUser) {
      chatTitle = titleFromMessage(firstUser);
      if (chatTitle !== title) setTitle(chatTitle);
    }
    let assistant = "";
    let reasoning = "";
    let responseModel = "";
    let toolEvents: ChatToolEvent[] = [];
    let stats: ChatStats | undefined;
    const modelName = usingExternal
      ? activeEndpoint?.model || activeEndpoint?.name || "external"
      : shortModelName(config?.model);

    const updateAssistant = (patch: Partial<ChatMessageRecord> = {}) => {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: assistant,
          reasoning: reasoning || undefined,
          model: modelName,
          toolEvents: toolEvents.length ? [...toolEvents] : undefined,
          stats,
          ...patch,
        };
        return copy;
      });
    };

    try {
      if (!usingExternal && !config?.loaded) {
        setToolLabel("Loading model into memory…");
        await api.loadModel(shortModelName(config?.model));
        await refreshConfig();
        setToolLabel(null);
      }

      if (!chatIdToUse) {
        chatTitle = titleFromMessage(firstUser);
        const created = await api.saveChat({ title: chatTitle, messages: [] });
        chatIdToUse = created.chat.id;
        justCreatedRef.current = chatIdToUse;
        setActiveId(chatIdToUse);
        setTitle(chatTitle);
        onChatCreated(chatIdToUse);
      }

      const apiMessages = await buildApiMessages(history);
      const res = await api.chat(apiMessages, {
        stream: true,
        chatId: chatIdToUse,
        signal: controller.signal,
        thinkingEffort: config?.thinkingEffort,
      });

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
            model?: string;
            args?: unknown;
            result?: unknown;
            completionTokens?: number;
            promptTokens?: number;
            durationMs?: number;
            tokensPerSecond?: number;
            choices?: { delta?: { content?: string } }[];
          };
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          if (json.error) throw new Error(json.error);
          if (json.model) responseModel = json.model;
          if (json.type === "usage") {
            stats = {
              completionTokens: json.completionTokens,
              promptTokens: json.promptTokens,
              durationMs: json.durationMs,
              tokensPerSecond: json.tokensPerSecond,
            };
            updateAssistant();
            continue;
          }
          if (json.type === "tool") {
            const name = json.name || "tool";
            toolEvents = [
              ...toolEvents,
              { name, args: json.args, status: "running" },
            ];
            setToolLabel(`Running ${name}…`);
            updateAssistant();
            continue;
          }
          if (json.type === "tool_result") {
            const runningIndex = [...toolEvents]
              .map((event, index) => ({ event, index }))
              .reverse()
              .find(({ event }) => event.status === "running")?.index;
            if (runningIndex !== undefined) {
              toolEvents = toolEvents.map((event, index) =>
                index === runningIndex
                  ? {
                      ...event,
                      name: json.name || event.name,
                      result: json.result,
                      status: "done",
                    }
                  : event,
              );
            } else if (json.name) {
              toolEvents = [
                ...toolEvents,
                { name: json.name, result: json.result, status: "done" },
              ];
            }
            setToolLabel(null);
            updateAssistant();
            continue;
          }
          if (json.type === "reasoning" && json.content) {
            reasoning += json.content;
            updateAssistant();
            continue;
          }
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            assistant += delta;
            updateAssistant();
          }
        }
      }

      if (!assistant) {
        assistant = "(The model returned an empty response.)";
      }
      const finalModel = responseModel || modelName;
      const finalToolEvents = toolEvents.length ? toolEvents : undefined;
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: assistant,
          reasoning: reasoning || undefined,
          model: finalModel,
          toolEvents: finalToolEvents,
          stats,
        };
        return copy;
      });

      await api.updateChat(chatIdToUse, {
        title: chatTitle,
        messages: [
          ...history,
          {
            role: "assistant",
            content: assistant,
            reasoning: reasoning || undefined,
            model: finalModel,
            toolEvents: finalToolEvents,
            stats,
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
          const last = copy[copy.length - 1];
          if (
            last &&
            last.role === "assistant" &&
            !last.content &&
            !last.reasoning &&
            !(last.toolEvents && last.toolEvents.length)
          ) {
            copy.pop();
          }
          return copy;
        });
      } else {
        setError(err.message);
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (
            last &&
            last.role === "assistant" &&
            !last.content &&
            !last.reasoning &&
            !(last.toolEvents && last.toolEvents.length)
          ) {
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
    if ((!text && attachments.length === 0) || sending) return;
    const pending = attachments.length ? [...attachments] : undefined;
    const history: ChatMessageRecord[] = [
      ...messages.filter((m) => m.role === "user" || m.role === "assistant"),
      { role: "user", content: text, attachments: pending },
    ];
    setInput("");
    setAttachments([]);
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
    setAttachments([]);
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
                  config?.loaded || usingExternal
                    ? "bg-success"
                    : "bg-muted-foreground/40",
                )}
              />
              <span className="truncate">
                {loadingModel && loadingModel !== "__unload__"
                  ? "Loading…"
                  : activeLabel || "Select model"}
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
                  orderedModels.map((m) => (
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
                          {m.starred && (
                            <Star className="mr-1 inline h-2.5 w-2.5 fill-current text-warning align-[-1px]" />
                          )}
                          {m.vision && (
                            <Eye
                              className="mr-1 inline h-2.5 w-2.5 text-muted-foreground align-[-1px]"
                              aria-label="Vision model"
                            />
                          )}
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
                {usingExternal
                  ? `Using ${activeEndpoint.name}${activeEndpoint.model ? ` · ${activeEndpoint.model}` : ""}. Messages are sent to that OpenAI-compatible endpoint.`
                  : config?.model
                    ? `${shortModelName(config.model)} is ${config.loaded ? "loaded and ready" : "selected — it will load on your first message"}.`
                    : "Download a GGUF model from Models, then start chatting locally on your GPU or CPU."}
              </p>
              {!usingExternal && !config?.model && (
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
                attachments={m.attachments}
                toolEvents={m.toolEvents}
                stats={m.stats}
                defaultShowReasoning={showThinking}
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

          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment, index) => (
                <span
                  key={`${attachment.path}-${index}`}
                  className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground"
                  title={attachment.path}
                >
                  {attachment.kind === "image" ? (
                    <img
                      src={attachmentUrl(attachment)}
                      alt={attachment.name}
                      loading="lazy"
                      className="h-7 w-7 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <FileText className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate">{attachment.name}</span>
                  <span className="shrink-0 opacity-60">
                    {attachment.sizeStr || formatBytes(attachment.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(index)}
                    className="rounded p-0.5 hover:bg-accent hover:text-foreground"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {!usingExternal &&
            config &&
            !config.visionReady &&
            attachments.some((attachment) => attachment.kind === "image") && (
              <p className="mb-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-[10.5px] text-warning">
                <Eye className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  The selected model has no vision projector. Add a matching
                  mmproj-*.gguf next to the model, or choose one in Settings, so
                  it can see this image.
                </span>
              </p>
            )}

          <div className="rounded-xl border border-border bg-card transition-colors focus-within:border-ring">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={
                usingExternal || config?.model
                  ? "Send a message…"
                  : "Select or download a model to start…"
              }
              className="max-h-[200px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || sending}
                  className="btn btn-ghost btn-icon h-6 w-6 shrink-0"
                  title="Attach files"
                  aria-label="Attach files"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5" />
                  )}
                </button>
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    config?.loaded || usingExternal
                      ? "bg-success"
                      : config?.model
                        ? "bg-warning"
                        : "bg-muted-foreground/40",
                  )}
                />
                <span className="truncate">
                  {activeLabel || "No model"}
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
                  disabled={!input.trim() && attachments.length === 0}
                  className="btn btn-primary btn-icon h-7 w-7"
                  title="Send"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground/70">
            Enter to send · Shift+Enter for a new line · Attach files with the
            paperclip · Everything runs locally
          </p>
        </div>
      </div>
    </div>
  );
}
