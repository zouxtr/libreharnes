import * as React from "react";
import { api } from "./api";
import type {
  ChatSummary,
  Config,
  ModelInfo,
  SystemInfo,
  ThemePref,
  ToastItem,
} from "./types";
import { shortModelName } from "./utils";

interface HarnessContextValue {
  config: Config | null;
  models: ModelInfo[];
  chats: ChatSummary[];
  system: SystemInfo | null;
  error: string | null;
  ready: boolean;
  refreshConfig: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshChats: () => Promise<void>;
  refreshSystem: () => Promise<void>;
  refreshAll: () => Promise<void>;
  toast: (message: string, kind?: ToastItem["kind"]) => void;
  toasts: ToastItem[];
  dismissToast: (id: number) => void;
  theme: ThemePref;
  resolvedTheme: "light" | "dark";
  setTheme: (t: ThemePref) => void;
  loadedModelName: string;
  selectedModelName: string;
}

const HarnessContext = React.createContext<HarnessContextValue | null>(null);

function getInitialTheme(): ThemePref {
  try {
    const saved = localStorage.getItem("lh-theme");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function HarnessProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = React.useState<Config | null>(null);
  const [models, setModels] = React.useState<ModelInfo[]>([]);
  const [chats, setChats] = React.useState<ChatSummary[]>([]);
  const [system, setSystem] = React.useState<SystemInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const [theme, setThemeState] = React.useState<ThemePref>(getInitialTheme);
  const [systemDark, setSystemDark] = React.useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = React.useCallback((next: ThemePref) => {
    setThemeState(next);
    try {
      localStorage.setItem("lh-theme", next);
    } catch {
      /* ignore */
    }
  }, []);

  const toast = React.useCallback(
    (message: string, kind: ToastItem["kind"] = "info") => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev.slice(-3), { id, message, kind }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
    },
    [],
  );

  const dismissToast = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshConfig = React.useCallback(async () => {
    try {
      const next = await api.getConfig();
      setConfig(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReady(true);
    }
  }, []);

  const refreshModels = React.useCallback(async () => {
    try {
      const data = await api.getModels();
      setModels(data.models || []);
    } catch {
      /* keep previous models; config error banner covers connectivity */
    }
  }, []);

  const refreshChats = React.useCallback(async () => {
    try {
      const data = await api.getChats();
      setChats(data.chats || []);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshSystem = React.useCallback(async () => {
    try {
      setSystem(await api.getSystem());
    } catch {
      /* ignore */
    }
  }, []);

  const refreshAll = React.useCallback(async () => {
    await Promise.allSettled([
      refreshConfig(),
      refreshModels(),
      refreshChats(),
      refreshSystem(),
    ]);
  }, [refreshConfig, refreshModels, refreshChats, refreshSystem]);

  React.useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void Promise.allSettled([
        refreshConfig(),
        refreshModels(),
        refreshSystem(),
      ]);
    };
    tick();
    const id = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refreshConfig, refreshModels, refreshSystem]);

  React.useEffect(() => {
    void refreshChats();
    const id = window.setInterval(() => void refreshChats(), 6000);
    return () => window.clearInterval(id);
  }, [refreshChats]);

  const loadedModelName = config?.loaded ? shortModelName(config.model) : "";
  const selectedModelName = shortModelName(config?.model);

  const value: HarnessContextValue = {
    config,
    models,
    chats,
    system,
    error,
    ready,
    refreshConfig,
    refreshModels,
    refreshChats,
    refreshSystem,
    refreshAll,
    toast,
    toasts,
    dismissToast,
    theme,
    resolvedTheme,
    setTheme,
    loadedModelName,
    selectedModelName,
  };

  return (
    <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>
  );
}

export function useHarness(): HarnessContextValue {
  const ctx = React.useContext(HarnessContext);
  if (!ctx) throw new Error("useHarness must be used inside HarnessProvider");
  return ctx;
}
