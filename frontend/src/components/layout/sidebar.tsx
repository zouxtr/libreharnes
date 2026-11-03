import * as React from "react";
import {
  ChevronLeft,
  MessageSquare,
  Boxes,
  Wrench,
  Settings as SettingsIcon,
  Plus,
  Search,
  Trash2,
  Cpu,
  MemoryStick,
  PanelLeft,
  Square,
} from "lucide-react";
import { useHarness } from "@/lib/harness";
import { cn, shortModelName, timeAgo } from "@/lib/utils";
import type { Page } from "@/lib/types";

const NAV: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "models", label: "Models", icon: Boxes },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

interface SidebarProps {
  page: Page;
  onPageChange: (p: Page) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
}

export function Sidebar({
  page,
  onPageChange,
  collapsed,
  onToggleCollapse,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
}: SidebarProps) {
  const { chats, config, models, system, loadedModelName } = useHarness();
  const [query, setQuery] = React.useState("");

  const filteredChats = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => c.title.toLowerCase().includes(q));
  }, [chats, query]);

  const loaded = models.find((m) => m.loaded);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-[56px]" : "w-[260px]",
      )}
    >
      <div className={cn("flex h-12 items-center gap-2", collapsed ? "justify-center px-2" : "px-3")}>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[11px] font-bold tracking-tight text-background"
          title="Toggle sidebar"
        >
          LH
        </button>
        {!collapsed && (
          <>
            <span className="truncate text-[13px] font-semibold tracking-tight">
              LibreHarnes
            </span>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="btn btn-ghost btn-icon ml-auto h-7 w-7"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {collapsed ? (
        <div className="flex flex-col items-center gap-1 px-2 pt-1">
          <button
            type="button"
            onClick={onNewChat}
            className="btn btn-outline btn-icon h-8 w-8"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onPageChange(item.id)}
                title={item.label}
                className={cn(
                  "btn btn-icon h-8 w-8",
                  page === item.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={onNewChat}
              className="btn btn-outline btn-md w-full justify-start gap-2"
            >
              <Plus className="h-4 w-4" />
              New chat
            </button>
          </div>

          <nav className="space-y-0.5 px-2">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = page === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onPageChange(item.id)}
                  className={cn(
                    "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                  {item.id === "models" && models.length > 0 && (
                    <span className="ml-auto rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">
                      {models.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mx-3 my-2 h-px bg-border" />

          <div className="px-3 pb-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                className="h-7 w-full rounded-md border border-transparent bg-transparent pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-border focus:bg-background focus:outline-none"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {filteredChats.length === 0 ? (
              <p className="px-2 py-3 text-[11.5px] text-muted-foreground/70">
                {chats.length === 0 ? "No conversations yet." : "No matches."}
              </p>
            ) : (
              <div className="space-y-0.5">
                {filteredChats.map((chat) => (
                  <div
                    key={chat.id}
                    className={cn(
                      "group relative flex items-center rounded-md",
                      activeChatId === chat.id
                        ? "bg-accent"
                        : "hover:bg-accent/60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectChat(chat.id)}
                      className="flex min-w-0 flex-1 flex-col items-start px-2.5 py-1.5 text-left"
                      title={chat.title}
                    >
                      <span className="w-full truncate text-[12px] text-foreground">
                        {chat.title}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground/70">
                        {timeAgo(chat.updatedAt)}
                        {chat.messageCount > 0
                          ? ` · ${Math.floor(chat.messageCount / 2)} msg`
                          : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteChat(chat.id)}
                      className="mr-1 hidden rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive group-hover:block"
                      aria-label="Delete chat"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border p-2.5">
            <div className="rounded-md border border-border bg-card px-2.5 py-2">
              <div className="flex items-center gap-2">
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
                <span className="truncate text-[11.5px] font-medium text-foreground">
                  {config?.model ? shortModelName(config.model) : "No model selected"}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {config?.loaded
                    ? "Loaded"
                    : config?.llamaState === "starting"
                      ? "Loading…"
                      : config?.llamaState === "error"
                        ? "Load failed"
                        : "Not loaded"}
                </span>
                {loaded && <span>{loaded.sizeStr}</span>}
                {config?.loaded && loadedModelName && (
                  <span className="flex items-center gap-1 text-success">
                    <Square className="h-2 w-2 fill-current" />
                    CPU
                  </span>
                )}
              </div>
            </div>

            {system && (
              <div className="mt-2 space-y-1.5 px-0.5">
                <div className="flex items-center gap-2">
                  <Cpu className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                  <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-foreground/40 transition-[width] duration-500"
                      style={{ width: `${system.cpu}%` }}
                    />
                  </div>
                  <span className="w-7 text-right text-[9.5px] tabular-nums text-muted-foreground">
                    {system.cpu}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <MemoryStick className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                  <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-foreground/40 transition-[width] duration-500"
                      style={{ width: `${system.ramPercent}%` }}
                    />
                  </div>
                  <span className="w-7 text-right text-[9.5px] tabular-nums text-muted-foreground">
                    {system.ramPercent}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {collapsed && (
        <div className="mt-auto flex flex-col items-center gap-2 pb-3">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              config?.loaded ? "bg-success" : "bg-muted-foreground/40",
            )}
            title={config?.loaded ? "Model loaded" : "No model loaded"}
          />
          <PanelLeft className="h-3.5 w-3.5 text-muted-foreground/40" />
        </div>
      )}
    </aside>
  );
}
