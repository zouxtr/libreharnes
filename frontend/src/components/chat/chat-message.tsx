import * as React from "react";
import {
  Wrench,
  Sparkles,
  ChevronDown,
  Loader2,
  Cpu,
} from "lucide-react";
import { Markdown } from "@/components/common/Markdown";
import { cn, displayModelName } from "@/lib/utils";

interface ChatMessageProps {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  reasoning?: string;
  model?: string;
  streaming?: boolean;
  toolLabel?: string;
}

export function ChatMessage({
  role,
  content,
  reasoning,
  model,
  streaming,
  toolLabel,
}: ChatMessageProps) {
  const hasReasoning = !!reasoning && reasoning.trim().length > 0;
  const [showReasoning, setShowReasoning] = React.useState(false);
  const autoOpened = React.useRef(false);

  // Open the thinking block automatically while the model is still reasoning,
  // then tuck it away once the visible answer starts streaming in.
  React.useEffect(() => {
    if (streaming && hasReasoning && !content) {
      setShowReasoning(true);
      autoOpened.current = true;
    } else if (content && autoOpened.current) {
      setShowReasoning(false);
      autoOpened.current = false;
    }
  }, [streaming, hasReasoning, content]);

  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-[13.5px] leading-relaxed text-foreground">
          {content}
        </div>
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

        {model && (
          <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80">
            <Cpu className="h-3 w-3 shrink-0" />
            <span className="truncate">{displayModelName(model)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
