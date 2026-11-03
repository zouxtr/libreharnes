import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useHarness } from "@/lib/harness";

export function Toasts() {
  const { toasts, dismissToast } = useHarness();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => {
        const Icon =
          t.kind === "success"
            ? CheckCircle2
            : t.kind === "error"
              ? AlertCircle
              : Info;
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-lg border border-border bg-popover px-3 py-2.5 shadow-lg shadow-black/20"
          >
            <Icon
              className={
                "mt-0.5 h-4 w-4 shrink-0 " +
                (t.kind === "success"
                  ? "text-success"
                  : t.kind === "error"
                    ? "text-destructive"
                    : "text-muted-foreground")
              }
            />
            <p className="flex-1 text-[12.5px] leading-relaxed text-foreground">
              {t.message}
            </p>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
