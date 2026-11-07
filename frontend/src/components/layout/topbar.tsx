import * as React from "react";
import {
  MoreHorizontal,
  Moon,
  Sun,
  Monitor,
  Plus,
  Info,
  Boxes,
  WifiOff,
} from "lucide-react";
import { useHarness } from "@/lib/harness";
import { useClickOutside } from "@/lib/use-click-outside";
import { cn } from "@/lib/utils";
import type { Page } from "@/lib/types";

const TITLES: Record<Page, string> = {
  chat: "Chat",
  models: "Models",
  tools: "Tools",
  settings: "Settings",
};

interface TopBarProps {
  page: Page;
  onNewChat: () => void;
  onAbout: () => void;
  onOpenModels: () => void;
}

export function TopBar({ page, onNewChat, onAbout, onOpenModels }: TopBarProps) {
  const { config, theme, setTheme, error } = useHarness();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = useClickOutside<HTMLDivElement>(
    () => setMenuOpen(false),
    menuOpen,
  );

  const themeIcon =
    theme === "light" ? Sun : theme === "system" ? Monitor : Moon;
  const ThemeIcon = themeIcon;

  const activeEndpoint = config?.endpoints?.find(
    (e) => e.name === config?.activeEndpoint,
  );
  const backendLabel = activeEndpoint
    ? activeEndpoint.model || activeEndpoint.name
    : config?.model
      ? config.model.replace(/^models\//, "").replace(/\.gguf$/i, "")
      : "";

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="text-[13px] font-semibold text-foreground">
          {TITLES[page]}
        </h1>
        {backendLabel && (
          <span className="hidden truncate text-[11.5px] text-muted-foreground sm:inline">
            · {backendLabel}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <div
          className={cn(
            "mr-1 hidden items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10.5px] sm:flex",
            error ? "text-destructive" : "text-muted-foreground",
          )}
          title={error || "Backend connected"}
        >
          {error ? (
            <WifiOff className="h-3 w-3" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
          )}
          {error ? "Offline" : "Connected"}
        </div>

        <button
          type="button"
          onClick={() =>
            setTheme(
              theme === "dark"
                ? "light"
                : theme === "light"
                  ? "system"
                  : "dark",
            )
          }
          className="btn btn-ghost btn-icon"
          title={`Theme: ${theme}`}
          aria-label="Toggle theme"
        >
          <ThemeIcon className="h-4 w-4" />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={cn("btn btn-ghost btn-icon", menuOpen && "bg-accent text-foreground")}
            aria-label="More options"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="menu absolute right-0 top-full mt-1 w-[190px] animate-slide-up">
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onNewChat();
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                New chat
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenModels();
                }}
              >
                <Boxes className="h-3.5 w-3.5" />
                Manage models
              </button>
              <div className="menu-sep" />
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onAbout();
                }}
              >
                <Info className="h-3.5 w-3.5" />
                About LibreHarnes
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
