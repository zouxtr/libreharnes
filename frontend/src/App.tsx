import * as React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { HarnessProvider, useHarness } from "@/lib/harness";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { ChatPage } from "@/components/chat/chat-page";
import { ModelsPage } from "@/components/models/models-page";
import { ToolsPage } from "@/components/tools/tools-page";
import { SettingsPage } from "@/components/settings/settings-page";
import { Toasts } from "@/components/common/Toasts";
import { Modal } from "@/components/common/Modal";

function AboutDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="About LibreHarnes">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-[12px] font-bold tracking-tight text-background">
            LH
          </div>
          <div>
            <p className="text-[13px] font-semibold text-foreground">
              LibreHarnes
            </p>
            <p className="text-[11px] text-muted-foreground">
              Version 0.1 · local-first AI harness
            </p>
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          A lightweight, CPU-only chat harness built on llama.cpp. No bundled
          models, no telemetry. Download GGUF models from Hugging Face and run
          them locally, or connect any OpenAI-compatible API.
        </p>
        <div className="grid grid-cols-2 gap-2 text-[11.5px]">
          <a
            href="https://github.com/ggml-org/llama.cpp"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-2.5 py-2 text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            llama.cpp
          </a>
          <a
            href="https://huggingface.co/models?library=gguf"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-2.5 py-2 text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            GGUF models on Hugging Face
          </a>
        </div>
        <p className="text-[10.5px] text-muted-foreground/70">
          Runs on Linux, macOS, and Windows. Your data stays on this machine.
        </p>
      </div>
    </Modal>
  );
}

function Shell() {
  const { error, ready, refreshAll, refreshChats, config } = useHarness();
  const [page, setPage] = React.useState<Page>("chat");
  const [collapsed, setCollapsed] = React.useState(false);
  const [activeChatId, setActiveChatId] = React.useState<string | null>(null);
  const [resetNonce, setResetNonce] = React.useState(0);
  const [aboutOpen, setAboutOpen] = React.useState(false);

  const newChat = React.useCallback(() => {
    setActiveChatId(null);
    setResetNonce((n) => n + 1);
    setPage("chat");
  }, []);

  const selectChat = React.useCallback((id: string) => {
    setActiveChatId(id);
    setPage("chat");
  }, []);

  const deleteChat = React.useCallback(
    async (id: string) => {
      try {
        await api.deleteChat(id);
        if (activeChatId === id) {
          setActiveChatId(null);
          setResetNonce((n) => n + 1);
        }
        await refreshChats();
      } catch {
        /* ignore */
      }
    },
    [activeChatId, refreshChats],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        newChat();
      }
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar
        page={page}
        onPageChange={setPage}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        activeChatId={activeChatId}
        onSelectChat={selectChat}
        onNewChat={newChat}
        onDeleteChat={(id) => void deleteChat(id)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          page={page}
          onNewChat={newChat}
          onAbout={() => setAboutOpen(true)}
          onOpenModels={() => setPage("models")}
        />

        {!ready ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Connecting to the backend…
            </div>
          </div>
        ) : !config && error ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
              <AlertCircle className="mx-auto mb-2 h-5 w-5 text-destructive" />
              <h2 className="text-[13.5px] font-semibold text-foreground">
                Backend not reachable
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void refreshAll()}
                className="btn btn-outline btn-md mt-3"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
              <p className="mt-3 font-mono text-[10.5px] text-muted-foreground">
                cd harness &amp;&amp; node src/index.js
              </p>
            </div>
          </div>
        ) : (
          <main className="min-h-0 flex-1 overflow-hidden">
            {/*
              Keep the chat mounted across page switches so an in-flight
              response keeps streaming and the composer keeps its draft.
            */}
            <div className={page === "chat" ? "h-full" : "hidden"}>
              <ChatPage
                chatId={activeChatId}
                resetNonce={resetNonce}
                onChatCreated={setActiveChatId}
                onOpenModels={() => setPage("models")}
              />
            </div>
            {page === "models" && <ModelsPage />}
            {page === "tools" && <ToolsPage />}
            {page === "settings" && <SettingsPage />}
          </main>
        )}
      </div>

      <Toasts />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <HarnessProvider>
      <Shell />
    </HarnessProvider>
  );
}
