import type {
  Chat,
  ChatSummary,
  Config,
  DownloadJob,
  HfFile,
  HfResult,
  LlamaStatus,
  ModelInfo,
  ProjectorInfo,
  SystemInfo,
  ThinkingEffort,
  ToolInfo,
  UploadedFile,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(
      "Cannot reach the LibreHarnes backend. Is it running on port 3030?",
    );
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const obj = data as Record<string, unknown> | null;
    const msg =
      (obj && (obj.error as string)) ||
      (obj && (obj.message as string)) ||
      `Request failed (${res.status})`;
    throw new ApiError(String(msg), res.status);
  }
  return data as T;
}

function json(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

export const api = {
  // Config / status
  getConfig: () => request<Config>("/api/config"),
  saveConfig: (patch: Partial<Config> & Record<string, unknown>) =>
    request<{ ok: boolean; config: Config }>("/api/config", json(patch)),
  getStatus: () =>
    request<LlamaStatus & { config: Config }>("/api/status"),
  getSystem: () => request<SystemInfo>("/api/system"),

  // Models
  getModels: () =>
    request<{
      models: ModelInfo[];
      projectors: ModelInfo[];
      mmproj: string;
      loadedMmproj: string;
      active: string;
      llamaState: Config["llamaState"];
      llamaError: string | null;
    }>("/api/models"),
  loadModel: (name: string, mmproj?: string) =>
    request<{ ok: boolean; status: LlamaStatus; config: Config }>(
      "/api/models/load",
      json(mmproj === undefined ? { name } : { name, mmproj }),
    ),
  unloadModel: () =>
    request<{ ok: boolean; status: LlamaStatus }>(
      "/api/models/unload",
      json({}),
    ),
  deleteModel: (name: string) =>
    request<{ ok: boolean }>("/api/models/delete", json({ name })),
  starModel: (name: string, starred: boolean) =>
    request<{ ok: boolean; starredModels: string[] }>(
      "/api/models/star",
      json({ name, starred }),
    ),

  // Chats
  getChats: () => request<{ chats: ChatSummary[] }>("/api/chats"),
  getChat: (id: string) => request<{ chat: Chat }>(`/api/chats/${id}`),
  saveChat: (chat: Partial<Chat> & { id?: string }) =>
    request<{ ok: boolean; chat: Chat }>("/api/chats", json(chat)),
  updateChat: (id: string, chat: Partial<Chat>) =>
    request<{ ok: boolean; chat: Chat }>(`/api/chats/${id}`, {
      method: "PUT",
      body: JSON.stringify(chat),
    }),
  deleteChat: (id: string) =>
    request<{ ok: boolean }>(`/api/chats/${id}`, { method: "DELETE" }),

  // File uploads (raw request body, no multipart parser needed)
  uploadFile: (file: File) =>
    request<{ ok: boolean; file: UploadedFile }>(
      `/api/upload?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      },
    ),

  /**
   * Load an uploaded file (for example an image) as a base64 data URL so it
   * can be sent to local or remote vision models.
   */
  getUploadDataUrl: async (url: string): Promise<string> => {
    const res = await fetch(url);
    if (!res.ok) throw new ApiError(`Could not load ${url}`, res.status);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new ApiError(`Could not read ${url}`));
      reader.readAsDataURL(blob);
    });
  },

  // Hugging Face
  searchHf: (query: string, limit = 20) =>
    request<{ results: HfResult[] }>(
      `/api/hf/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    ),
  getHfFiles: (repo: string) =>
    request<{ repo: string; files: HfFile[] }>(
      `/api/hf/files?repo=${encodeURIComponent(repo)}`,
    ),
  startDownload: (repo: string, filename: string) =>
    request<{
      ok: boolean;
      job: DownloadJob;
      projector?: ProjectorInfo | null;
    }>("/api/hf/download", json({ repo, filename })),
  getProjector: (repo: string, filename: string) =>
    request<{
      repo: string;
      model: string;
      projector: { filename: string; size: number } | null;
    }>(
      `/api/hf/projector?repo=${encodeURIComponent(repo)}&filename=${encodeURIComponent(filename)}`,
    ),
  addVision: (model: string) =>
    request<{
      ok: boolean;
      repo: string;
      model: string;
      projector: ProjectorInfo;
    }>("/api/hf/projector", json({ model })),
  getJob: (id: string) =>
    request<{ job: DownloadJob }>(`/api/hf/jobs/${id}`),
  getJobs: () => request<{ jobs: DownloadJob[] }>("/api/hf/jobs"),
  cancelJob: (id: string) =>
    request<{ ok: boolean }>(`/api/hf/jobs/${id}/cancel`, json({})),
  resumeJob: (id: string) =>
    request<{ ok: boolean; job: DownloadJob }>(
      `/api/hf/jobs/${id}/resume`,
      json({}),
    ),
  removeJob: (id: string) =>
    request<{ ok: boolean }>(`/api/hf/jobs/${id}/remove`, json({})),

  // Tools
  getTools: () => request<{ tools: ToolInfo[] }>("/api/tools"),
  setTool: (name: string, enabled: boolean) =>
    request<{ ok: boolean; toolsEnabled: Record<string, boolean> }>(
      "/api/tools",
      json({ name, enabled }),
    ),
  testTool: (name: string, args: Record<string, unknown>) =>
    request<{ ok: boolean; result: unknown; error?: string }>(
      "/api/tools/test",
      json({ name, args }),
    ),

  // Chat completion (streaming handled separately)
  chat: (
    messages: { role: string; content: unknown }[],
    opts: {
      stream?: boolean;
      temperature?: number;
      thinkingEffort?: ThinkingEffort;
      chatId?: string;
      signal?: AbortSignal;
    } = {},
  ) =>
    fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opts.signal,
      body: JSON.stringify({
        messages,
        stream: !!opts.stream,
        temperature: opts.temperature,
        thinking_effort:
          opts.thinkingEffort && opts.thinkingEffort !== "default"
            ? opts.thinkingEffort
            : undefined,
        chatId: opts.chatId,
      }),
    }),
};
