import * as React from "react";
import {
  Wrench,
  Sparkles,
  ChevronDown,
  Loader2,
  Cpu,
  FileText,
  CheckCircle2,
  XCircle,
  Gauge,
} from "lucide-react";
import { Markdown } from "@/components/common/Markdown";
import type { ChatAttachment, ChatStats, ChatToolEvent } from "@/lib/types";
import { cn, displayModelName } from "@/lib/utils";

interface ChatMessageProps {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  reasoning?: string;
  model?: string;
  streaming?: boolean;
  toolLabel?: string;
  attachments?: ChatAttachment[];
  toolEvents?: ChatToolEvent[];
  stats?: ChatStats;
  /** Expand thinking blocks by default (the chat toolbar toggle). */
  defaultShowReasoning?: boolean;
}

function prettyValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function hasErrorResult(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "error" in (value as Record<string, unknown>)
  );
}

function ToolEventRow({ event }: { event: ChatToolEvent }) {
  const [open, setOpen] = React.useState(false);
  const running = event.status === "running";
  const failed = event.status === "error" || hasErrorResult(event.result);
  const argsText = prettyValue(event.args);
  const resultText = prettyValue(event.result);

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Wrench className="h-3 w-3 shrink-0" />
        <span className="shrink-0 font-medium">Tool</span>
        <span className="truncate font-mono text-[11px] text-foreground">
          {event.name}
        </span>
        {running ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : failed ? (
          <XCircle className="h-3 w-3 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
        )}
        <span className="ml-auto shrink-0 text-[10px] opacity-70">
          {open ? "Hide" : "Details"}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-2.5 py-2">
          {argsText && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Arguments
              </div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
                {argsText}
              </pre>
            </div>
          )}
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Result
            </div>
            {resultText ? (
              <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
                {resultText}
              </pre>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {running ? "Running…" : "No output"}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AttachmentChip({ attachment }: { attachment: ChatAttachment }) {
  return (
    <span
      className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10.5px] text-muted-foreground"
      title={attachment.path}
    >
      <FileText className="h-3 w-3 shrink-0" />
      <span className="truncate">{attachment.name}</span>
      {attachment.sizeStr && (
        <span className="shrink-0 opacity-60">{attachment.sizeStr}</span>
      )}
    </span>
  );
}

export function ChatMessage({
  role,
  content,
  reasoning,
  model,
  streaming,
  toolLabel,
  attachments,
  toolEvents,
  stats,
  defaultShowReasoning,
}: ChatMessageProps) {
  const hasReasoning = !!reasoning && reasoning.trim().length > 0;
  const [showReasoning, setShowReasoning] = React.useState(false);
  const autoOpened = React.useRef(false);

  // Open the thinking block automatically while the model is still reasoning,
  // then tuck it away once the visible answer starts streaming in. When the
  // toolbar toggle is on, always keep it open.
  React.useEffect(() => {
    if (defaultShowReasoning && hasReasoning) {
      setShowReasoning(true);
      autoOpened.current = false;
      return;
    }
    if (defaultShowReasoning) return;
    if (streaming && hasReasoning && !content) {
      setShowReasoning(true);
      autoOpened.current = true;
    } else if (content && autoOpened.current) {
      setShowReasoning(false);
      autoOpened.current = false;
    }
  }, [streaming, hasReasoning, content, defaultShowReasoning]);

  if (role === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {content && (
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-[13.5px] leading-relaxed text-foreground">
            {content}
          </div>
        )}
        {attachments && attachments.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {attachments.map((attachment, index) => (
              <AttachmentChip
                key={`${attachment.path}-${index}`}
                attachment={attachment}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (role === "tool") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
        <Wrench className="h-3 w-3" />
        {content}
      </div>
    );
  }

  if (role === "system") {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-2 text-[11.5px] text-muted-foreground">
        {content}
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-card text-[9.5px] font-semibold tracking-wide text-muted-foreground">
        AI
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {toolEvents && toolEvents.length > 0 && (
          <div className="mb-2">
            {toolEvents.map((event, index) => (
              <ToolEventRow key={`${event.name}-${index}`} event={event} />
            ))}
          </div>
        )}

        {hasReasoning && (
          <div className="mb-2 overflow-hidden rounded-lg border border-border bg-card/60">
            <button
              type="button"
              onClick={() => {
                autoOpened.current = false;
                setShowReasoning((v) => !v);
              }}
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Sparkles className="h-3 w-3 shrink-0" />
              <span className="font-medium">Thinking</span>
              {streaming && !content && (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              )}
              <span className="ml-auto shrink-0 text-[10px] opacity-70">
                {showReasoning ? "Hide" : "Show"}
              </span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 shrink-0 transition-transform",
                  showReasoning && "rotate-180",
                )}
              />
            </button>
            {showReasoning && (
              <div className="max-h-[340px] overflow-y-auto border-t border-border px-2.5 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
                {reasoning}
              </div>
            )}
          </div>
        )}

        {content ? (
          <Markdown content={content} />
        ) : (
          <span className="text-[13px] text-muted-foreground">
            {toolLabel ? toolLabel : hasReasoning ? "" : "Thinking…"}
          </span>
        )}
        {streaming && content && (
          <span className="ml-0.5 inline-block h-[13px] w-[2px] animate-pulse bg-foreground/70 align-middle" />
        )}
        {streaming && !content && !hasReasoning && (
          <span className="ml-1 inline-flex gap-1 align-middle">
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
          </span>
        )}

        {(model || stats) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground/80">
            {model && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Cpu className="h-3 w-3 shrink-0" />
                <span className="truncate">{displayModelName(model)}</span>
              </span>
            )}
            {stats?.tokensPerSecond !== undefined && (
              <span
                className="inline-flex items-center gap-1"
                title="Generation speed"
              >
                <Gauge className="h-3 w-3 shrink-0" />
                {stats.tokensPerSecond.toFixed(1)} tok/s
              </span>
            )}
            {stats?.completionTokens !== undefined && (
              <span title="Generated tokens">
                {stats.completionTokens} tokens
              </span>
            )}
            {stats?.durationMs !== undefined && (
              <span title="Generation time">
                {(stats.durationMs / 1000).toFixed(2)}s
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
