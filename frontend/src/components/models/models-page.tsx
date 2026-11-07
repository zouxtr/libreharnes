import * as React from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  Eye,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Square,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useHarness } from "@/lib/harness";
import { api } from "@/lib/api";
import type { DownloadJob, HfFile, HfResult, ModelInfo } from "@/lib/types";
import { cn, formatBytes, shortModelName } from "@/lib/utils";
import { EmptyState } from "@/components/common/Primitives";
import { Modal } from "@/components/common/Modal";

type LocalFilter = "all" | "starred" | "loaded" | "unloaded";
type DiscoverFilter = "all" | "downloaded" | "available";
type Tab = "local" | "discover" | "downloads";

/** Most recent job for a given filename. */
function latestJob(jobs: Record<string, DownloadJob>, filename: string) {
  return Object.values(jobs)
    .filter((job) => job.filename === filename)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

export function ModelsPage() {
  const { models, config, refreshModels, refreshConfig, toast } = useHarness();
  const [tab, setTab] = React.useState<Tab>("local");
  const [localFilter, setLocalFilter] = React.useState<LocalFilter>("all");
  const [discoverFilter, setDiscoverFilter] =
    React.useState<DiscoverFilter>("all");
  const [query, setQuery] = React.useState("gguf");
  const [results, setResults] = React.useState<HfResult[]>([]);
  const [files, setFiles] = React.useState<Record<string, HfFile[]>>({});
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [jobs, setJobs] = React.useState<Record<string, DownloadJob>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [starring, setStarring] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ModelInfo | null>(null);
  const [projectors, setProjectors] = React.useState<ModelInfo[]>([]);
  const [projectorChoice, setProjectorChoice] = React.useState<
    Record<string, string>
  >({});
  const jobStatusRef = React.useRef<Record<string, string>>({});

  const localNames = React.useMemo(
    () =>
      new Set([
        ...models.map((model) => model.name),
        ...projectors.map((projector) => projector.name),
      ]),
    [models, projectors],
  );

  const refreshProjectors = React.useCallback(() => {
    api
      .getModels()
      .then((data) => setProjectors(data.projectors || []))
      .catch(() => {
        /* projector list is optional */
      });
  }, []);

  React.useEffect(() => {
    refreshProjectors();
  }, [refreshProjectors, models.length]);

  React.useEffect(() => {
    api
      .getJobs()
      .then(({ jobs: list }) => {
        const next: Record<string, DownloadJob> = {};
        for (const job of list) next[job.id] = job;
        setJobs(next);
      })
      .catch(() => {
        /* downloads list is optional */
      });
  }, []);

  const anyDownloading = Object.values(jobs).some(
    (job) => job.status === "downloading",
  );
  const sortedJobs = React.useMemo(
    () => Object.values(jobs).sort((a, b) => b.startedAt - a.startedAt),
    [jobs],
  );
  const activeDownloads = sortedJobs.filter(
    (job) => job.status === "downloading",
  ).length;

  // Poll jobs while a transfer is running or the downloads tab is open.
  React.useEffect(() => {
    if (!anyDownloading && tab !== "downloads") return;
    const id = window.setInterval(() => {
      api
        .getJobs()
        .then(({ jobs: list }) => {
          const next: Record<string, DownloadJob> = {};
          for (const job of list) next[job.id] = job;
          setJobs(next);
        })
        .catch(() => {
          /* ignore */
        });
    }, 1000);
    return () => window.clearInterval(id);
  }, [anyDownloading, tab]);

  // Notify when a download finishes or fails.
  React.useEffect(() => {
    let completed = false;
    let failed = false;
    for (const job of Object.values(jobs)) {
      const previous = jobStatusRef.current[job.id];
      if (previous === "downloading" && job.status === "done") completed = true;
      if (previous === "downloading" && job.status === "error") failed = true;
      jobStatusRef.current[job.id] = job.status;
    }
    if (completed) {
      toast("Download complete", "success");
      void refreshModels();
      refreshProjectors();
    }
    if (failed) toast("Download failed — click retry to resume", "error");
  }, [jobs, refreshModels, refreshProjectors, toast]);

  // Debounced Hugging Face search.
  React.useEffect(() => {
    if (tab !== "discover") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      api
        .searchHf(query.trim() || "gguf", 20)
        .then(async ({ results: found }) => {
          if (cancelled) return;
          setResults(found);
          const settled = await Promise.allSettled(
            found.map((result) => api.getHfFiles(result.id)),
          );
          if (cancelled) return;
          const next: Record<string, HfFile[]> = {};
          settled.forEach((entry, index) => {
            if (entry.status === "fulfilled") {
              next[found[index].id] = entry.value.files;
            }
          });
          setFiles(next);
        })
        .catch((e) => {
          if (cancelled) return;
          setSearchError(e instanceof Error ? e.message : String(e));
          setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, query]);

  const downloadedCount = React.useMemo(
    () =>
      results.filter((result) =>
        (files[result.id] || []).some((file) => localNames.has(file.filename)),
      ).length,
    [results, files, localNames],
  );

  const visibleModels = React.useMemo(
    () =>
      [...models]
        .sort(
          (a, b) =>
            Number(b.starred) - Number(a.starred) ||
            a.name.localeCompare(b.name),
        )
        .filter((model) =>
          localFilter === "starred"
            ? model.starred
            : localFilter === "loaded"
              ? model.loaded
              : localFilter === "unloaded"
                ? !model.loaded
                : true,
        ),
    [models, localFilter],
  );

  const visibleResults = results.filter((result) => {
    const downloaded = (files[result.id] || []).some((file) =>
      localNames.has(file.filename),
    );
    if (discoverFilter === "downloaded") return downloaded;
    if (discoverFilter === "available") return !downloaded;
    return true;
  });

  const loadModel = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      const choice = projectorChoice[name] ?? "";
      await api.loadModel(name, choice);
      await Promise.all([refreshModels(), refreshConfig()]);
      refreshProjectors();
      toast(`Loaded ${shortModelName(name)}`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const unloadModel = async () => {
    setBusy("__unload__");
    setError(null);
    try {
      await api.unloadModel();
      await Promise.all([refreshModels(), refreshConfig()]);
      toast("Model unloaded", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const starModel = async (name: string, starred: boolean) => {
    setStarring(name);
    setError(null);
    try {
      await api.starModel(name, starred);
      await Promise.all([refreshModels(), refreshConfig()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarring(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.name;
    setDeleteTarget(null);
    setBusy(name);
    try {
      await api.deleteModel(name);
      await Promise.all([refreshModels(), refreshConfig()]);
      refreshProjectors();
      toast(`Deleted ${name}`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const startDownload = async (repo: string, filename: string) => {
    setError(null);
    try {
      const { job } = await api.startDownload(repo, filename);
      setJobs((prev) => ({ ...prev, [job.id]: job }));
      toast(`Downloading ${filename}`, "info");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const cancelJob = async (job: DownloadJob) => {
    try {
      await api.cancelJob(job.id);
      setJobs((prev) => ({
        ...prev,
        [job.id]: { ...job, status: "cancelled" },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const resumeJob = async (job: DownloadJob) => {
    setError(null);
    try {
      const { job: resumed } = await api.resumeJob(job.id);
      setJobs((prev) => ({ ...prev, [resumed.id]: resumed }));
      toast(`Resuming ${job.filename}`, "info");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeJob = async (job: DownloadJob) => {
    setError(null);
    try {
      await api.removeJob(job.id);
      setJobs((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const renderFileAction = (repo: string, file: HfFile) => {
    const local = models.find((model) => model.name === file.filename);
    const job = latestJob(jobs, file.filename);
    const isProjector = /mmproj/i.test(file.filename);
    const projectorLocal = projectors.some(
      (projector) => projector.name === file.filename,
    );

    // Vision projectors are not loaded as models; they pair with a model.
    if (isProjector && projectorLocal) {
      return (
        <span className="badge badge-solid">
          <Eye className="h-2.5 w-2.5" />
          Projector saved
        </span>
      );
    }

    if (local) {
      return local.loaded ? (
        <div className="flex items-center gap-1.5">
          <span className="badge badge-success">
            <CheckCircle2 className="h-2.5 w-2.5" />
            Loaded
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void unloadModel()}
            disabled={!!busy}
          >
            Unload
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="badge badge-solid">Downloaded</span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => void loadModel(local.name)}
            disabled={!!busy}
          >
            {busy === local.name ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Load
          </button>
        </div>
      );
    }

    if (job && job.status === "downloading") {
      return (
        <div className="flex w-full max-w-[260px] items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
              <span className="truncate">
                {job.total > 0
                  ? `${formatBytes(job.received)} / ${formatBytes(job.total)}`
                  : formatBytes(job.received)}
              </span>
              <span className="tabular-nums">{job.progress}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-foreground/50 transition-[width] duration-300"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon h-6 w-6"
            onClick={() => void cancelJob(job)}
            title="Cancel download"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      );
    }

    if (job && job.status === "error") {
      return (
        <div className="flex items-center gap-2">
          <span className="badge badge-danger">Failed</span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => void startDownload(repo, file.filename)}
          >
            <RotateCcw className="h-3 w-3" />
            Retry
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => void startDownload(repo, file.filename)}
      >
        <Download className="h-3 w-3" />
        Get
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
              Models
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Run GGUF models locally with GPU acceleration, or browse Hugging Face.
            </p>
          </div>
          <div className="flex rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => setTab("local")}
              className={cn(
                "rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                tab === "local"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Local
              {models.length > 0 && (
                <span className="ml-1 text-muted-foreground">
                  {models.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab("discover")}
              className={cn(
                "rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                tab === "discover"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Discover
            </button>
            <button
              type="button"
              onClick={() => setTab("downloads")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                tab === "downloads"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Downloads
              {activeDownloads > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9.5px] font-semibold text-background">
                  {activeDownloads}
                </span>
              )}
            </button>
          </div>
        </div>

        {tab === "local" && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(
              [
                ["all", "All", models.length],
                ["starred", "Starred", models.filter((m) => m.starred).length],
                ["loaded", "Loaded", models.filter((m) => m.loaded).length],
                ["unloaded", "On disk", models.filter((m) => !m.loaded).length],
              ] as [LocalFilter, string, number][]
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLocalFilter(value)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                  localFilter === value
                    ? "border-foreground/30 bg-secondary text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                <span className="ml-1 opacity-60">{count}</span>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              {config?.loaded && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void unloadModel()}
                  disabled={!!busy}
                >
                  Unload model
                </button>
              )}
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setTab("discover")}
              >
                <Search className="h-3 w-3" />
                Find models
              </button>
            </div>
          </div>
        )}

        {tab === "discover" && (
          <div className="mt-3 space-y-2.5">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Hugging Face for GGUF models…"
                className="input h-8 pl-8 pr-8"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["all", "All", results.length],
                  ["downloaded", "Downloaded", downloadedCount],
                  [
                    "available",
                    "Available",
                    Math.max(0, results.length - downloadedCount),
                  ],
                ] as [DiscoverFilter, string, number][]
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDiscoverFilter(value)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                    discoverFilter === value
                      ? "border-foreground/30 bg-secondary text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  <span className="ml-1 opacity-60">{count}</span>
                </button>
              ))}
              {searching && (
                <span className="ml-1 flex items-center gap-1 text-[10.5px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Searching
                </span>
              )}
            </div>
          </div>
        )}

        {tab === "downloads" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>{activeDownloads} active</span>
            <span className="opacity-50">·</span>
            <span>
              {sortedJobs.filter((job) => job.status === "done").length} completed
            </span>
            <span className="opacity-50">·</span>
            <span>
              {sortedJobs.filter((job) => job.status === "error").length} failed
            </span>
            {anyDownloading && (
              <span className="ml-1 flex items-center gap-1 text-[10.5px]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Transferring
              </span>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm ml-auto"
              onClick={() => setTab("discover")}
            >
              <Download className="h-3 w-3" />
              Find more models
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11.5px] text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 whitespace-pre-wrap break-words">{error}</span>
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

        {tab === "local" && (
          <>
            {visibleModels.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title={
                  models.length === 0
                    ? "No local models yet"
                    : localFilter === "starred"
                      ? "No starred models yet"
                      : "Nothing matches this filter"
                }
                description={
                  models.length === 0
                    ? "Download a GGUF model from Hugging Face. Quantized models run well on a GPU or CPU."
                    : localFilter === "starred"
                      ? "Star a model with the star button to pin it here."
                      : "Try a different filter."
                }
                action={
                  models.length === 0 ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-md"
                      onClick={() => setTab("discover")}
                    >
                      <Search className="h-3.5 w-3.5" />
                      Browse models
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div className="space-y-2">
                {visibleModels.map((model) => (
                  <div key={model.name} className="row row-hover items-start">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                      <Cpu className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-medium text-foreground">
                          {shortModelName(model.name)}
                        </span>
                        {model.loaded && (
                          <span className="badge badge-success shrink-0">
                            <span className="h-1 w-1 rounded-full bg-current" />
                            Loaded
                          </span>
                        )}
                        {!model.loaded && model.active && (
                          <span className="badge badge-warning shrink-0">
                            Selected
                          </span>
                        )}
                        {model.vision && (
                          <span
                            className="badge shrink-0 border border-border text-muted-foreground"
                            title="A vision projector (mmproj) is available"
                          >
                            <Eye className="h-2.5 w-2.5" />
                            Vision
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                        <span className="font-mono">{model.name}</span>
                        <span>·</span>
                        <span>{model.sizeStr}</span>
                        <span>·</span>
                        <span className="rounded bg-secondary px-1">
                          {model.name.toUpperCase().includes("Q4")
                            ? "Q4"
                            : model.name.toUpperCase().includes("Q5")
                              ? "Q5"
                              : model.name.toUpperCase().includes("Q8")
                                ? "Q8"
                                : "GGUF"}
                        </span>
                      </div>
                      {!model.loaded && projectors.length > 0 && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <select
                            value={projectorChoice[model.name] ?? ""}
                            onChange={(e) =>
                              setProjectorChoice((prev) => ({
                                ...prev,
                                [model.name]: e.target.value,
                              }))
                            }
                            className="input h-7 max-w-[280px] text-[10.5px]"
                            title="Vision projector used when loading this model"
                          >
                            <option value="">Projector: auto-detect</option>
                            {projectors.map((projector) => (
                              <option
                                key={projector.name}
                                value={`models/${projector.name}`}
                              >
                                {projector.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        className={cn(
                          "btn btn-ghost btn-icon h-7 w-7",
                          model.starred
                            ? "text-warning hover:text-warning"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => void starModel(model.name, !model.starred)}
                        disabled={!!starring || !!busy}
                        title={model.starred ? "Remove star" : "Star this model"}
                        aria-pressed={model.starred}
                      >
                        {starring === model.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Star
                            className={cn(
                              "h-3.5 w-3.5",
                              model.starred && "fill-current",
                            )}
                          />
                        )}
                      </button>
                      {model.loaded ? (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => void unloadModel()}
                          disabled={!!busy}
                        >
                          <Square className="h-3 w-3" />
                          Unload
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => void loadModel(model.name)}
                          disabled={!!busy}
                        >
                          {busy === model.name ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-3 w-3" />
                          )}
                          Load
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(model)}
                        disabled={!!busy}
                        title="Delete model file"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "discover" && (
          <>
            {searchError && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11.5px] text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{searchError}</span>
              </div>
            )}
            {searching && results.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="row animate-pulse"
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    <div className="h-8 w-8 rounded-md bg-secondary" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-2.5 w-1/3 rounded bg-secondary" />
                      <div className="h-2 w-1/2 rounded bg-secondary" />
                    </div>
                  </div>
                ))}
              </div>
            ) : visibleResults.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No models found"
                description={
                  results.length === 0
                    ? "Try a different search term."
                    : "Nothing matches this filter."
                }
              />
            ) : (
              <div className="space-y-2">
                {visibleResults.map((result) => {
                  const repoFiles = files[result.id] || [];
                  const isOpen = expanded === result.id;
                  const downloaded = repoFiles.some((file) =>
                    localNames.has(file.filename),
                  );
                  return (
                    <div
                      key={result.id}
                      className="overflow-hidden rounded-lg border border-border bg-card"
                    >
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : result.id)}
                        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/40"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                          <Cpu className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[12.5px] font-medium text-foreground">
                              {result.id}
                            </span>
                            {downloaded && (
                              <span className="badge badge-success shrink-0">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                Downloaded
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                            <span>{result.author || "unknown"}</span>
                            <span>·</span>
                            <span>{result.downloads.toLocaleString()} downloads</span>
                            <span>·</span>
                            <span>{result.likes.toLocaleString()} likes</span>
                            {repoFiles.length > 0 && (
                              <>
                                <span>·</span>
                                <span>{repoFiles.length} GGUF files</span>
                              </>
                            )}
                          </div>
                        </div>
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                      {isOpen && (
                        <div className="border-t border-border bg-background/40 px-3.5 py-2">
                          {repoFiles.length === 0 ? (
                            <p className="py-2 text-[11.5px] text-muted-foreground">
                              No GGUF files found in this repository.
                            </p>
                          ) : (
                            <div className="divide-y divide-border/70">
                              {repoFiles.map((file) => (
                                <div
                                  key={file.filename}
                                  className="flex flex-wrap items-center gap-2 py-2"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate font-mono text-[11.5px] text-foreground">
                                      {file.filename}
                                    </p>
                                    <p className="text-[10.5px] text-muted-foreground">
                                      {file.size > 0
                                        ? formatBytes(file.size)
                                        : "size unknown"}
                                    </p>
                                  </div>
                                  {renderFileAction(result.id, file)}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === "downloads" && (
          <>
            {sortedJobs.length === 0 ? (
              <EmptyState
                icon={Download}
                title="No downloads yet"
                description="Models you download from Hugging Face will appear here with live progress. Interrupted downloads are paused and can be resumed."
                action={
                  <button
                    type="button"
                    className="btn btn-primary btn-md"
                    onClick={() => setTab("discover")}
                  >
                    <Search className="h-3.5 w-3.5" />
                    Browse models
                  </button>
                }
              />
            ) : (
              <div className="space-y-2">
                {sortedJobs.map((job) => {
                  const local = models.find(
                    (model) => model.name === job.filename,
                  );
                  const progress =
                    job.status === "done" ? 100 : Math.max(0, job.progress);
                  return (
                    <div key={job.id} className="row row-hover items-start">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                        <Download className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[12.5px] font-medium text-foreground">
                            {job.filename}
                          </span>
                          {job.status === "downloading" && (
                            <span className="badge badge-solid shrink-0">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              Downloading
                            </span>
                          )}
                          {job.status === "paused" && (
                            <span className="badge badge-warning shrink-0">
                              Paused
                            </span>
                          )}
                          {job.status === "cancelled" && (
                            <span className="badge badge-warning shrink-0">
                              Cancelled
                            </span>
                          )}
                          {job.status === "error" && (
                            <span className="badge badge-danger shrink-0">
                              Failed
                            </span>
                          )}
                          {job.status === "done" && (
                            <span className="badge badge-success shrink-0">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Complete
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-muted-foreground">
                          <span className="truncate">
                            {job.repo || "Hugging Face"}
                          </span>
                          <span>·</span>
                          <span className="tabular-nums">
                            {formatBytes(job.received)}
                            {job.total > 0 ? ` / ${formatBytes(job.total)}` : ""}
                          </span>
                          {job.total > 0 && job.status !== "done" && (
                            <>
                              <span>·</span>
                              <span className="tabular-nums">{progress}%</span>
                            </>
                          )}
                        </div>
                        {(job.status === "downloading" ||
                          job.status === "paused" ||
                          job.status === "error" ||
                          job.status === "cancelled") && (
                          <div className="mt-1.5 h-1 max-w-md overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-foreground/50 transition-[width] duration-300"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        )}
                        {job.error && (
                          <p className="mt-1 line-clamp-2 text-[10.5px] text-destructive">
                            {job.error}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {job.status === "downloading" && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => void cancelJob(job)}
                          >
                            <X className="h-3 w-3" />
                            Cancel
                          </button>
                        )}
                        {(job.status === "paused" ||
                          job.status === "cancelled" ||
                          job.status === "error") && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => void resumeJob(job)}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Resume
                          </button>
                        )}
                        {job.status === "done" && local && local.loaded && (
                          <span className="badge badge-success shrink-0">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Loaded
                          </span>
                        )}
                        {job.status === "done" && local && !local.loaded && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => void loadModel(local.name)}
                            disabled={!!busy}
                          >
                            {busy === local.name ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            Load
                          </button>
                        )}
                        {job.status === "done" && !local && (
                          <span className="text-[10.5px] text-muted-foreground">
                            File moved or deleted
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => void removeJob(job)}
                          title={
                            job.status === "downloading"
                              ? "Cancel and remove"
                              : "Remove from list"
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete model?"
        description={
          deleteTarget
            ? `${deleteTarget.name} (${deleteTarget.sizeStr}) will be removed from disk.`
            : undefined
        }
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline btn-md"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-md"
              onClick={() => void confirmDelete()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted-foreground">
          This cannot be undone. You can download the model again later.
        </p>
      </Modal>
    </div>
  );
}
