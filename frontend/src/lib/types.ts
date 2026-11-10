export type Page = "chat" | "models" | "tools" | "settings";
export type ThemePref = "light" | "dark" | "system";
export type ThinkingEffort = "default" | "low" | "high" | "disabled";

export interface Endpoint {
  name: string;
  baseUrl: string;
  key: string;
  /** Model ID sent to an external OpenAI-compatible endpoint. */
  model?: string;
  type?: string;
}

export interface Config {
  port: number;
  host: string;
  model: string;
  contextSize: number;
  threads: number;
  llamaPort: number;
  activeEndpoint: string;
  endpoints: Endpoint[];
  localApiKey: boolean;
  /** True when a Tavily API key is stored for the web_search tool. */
  hasTavilyKey: boolean;
  /** True when a Brave Search API key is stored for the web_search tool. */
  hasBraveKey: boolean;
  /** Order web_search tries search providers in (first one wins). */
  searchPriority: string[];
  hasLocalModel: boolean;
  llamaServer: string;
  llamaBackend: "auto" | "vulkan" | "cpu" | "metal";
  /** Number of model layers offloaded to the GPU (99 = all). */
  gpuLayers: number;
  flashAttention: boolean;
  /** Legacy global projector setting; empty in normal operation. */
  mmproj: string;
  /** Per-model projector pairing: model filename → mmproj path. */
  modelProjectors: Record<string, string>;
  temperature: number;
  topP: number;
  maxTokens: number;
  thinkingEffort: ThinkingEffort;
  toolsEnabled: Record<string, boolean>;
  /** Local model file names the user has starred. */
  starredModels: string[];
  systemPrompt: string;
  loaded: boolean;
  llamaState: "stopped" | "starting" | "ready" | "error";
  llamaError: string | null;
  /** Set when the GPU failed and the model was loaded on the CPU instead. */
  llamaWarning?: string | null;
  llamaGpuLayers?: number | null;
  llamaCpuFallback?: boolean;
  loadedMmproj?: string;
  /** True when the selected model has a usable vision projector. */
  visionReady?: boolean;
}

export interface ModelInfo {
  name: string;
  size: number;
  sizeStr: string;
  active: boolean;
  loaded: boolean;
  starred: boolean;
  /** True when this model is paired with a vision projector. */
  vision?: boolean;
  /** Projector path paired with this model, or empty for text-only. */
  projector?: string;
  /** Hugging Face repo the file was downloaded from, when known. */
  repo?: string | null;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  messageCount: number;
  model: string;
}

export type AttachmentKind = "image" | "text" | "file";

export interface ChatAttachment {
  name: string;
  /** Path relative to the LibreHarnes install root. */
  path: string;
  /** URL served by the local backend (used for image previews). */
  url?: string;
  mime?: string;
  kind?: AttachmentKind;
  size: number;
  sizeStr?: string;
  /** Decoded text content for text-like files. */
  text?: string;
}

export interface ChatToolEvent {
  name: string;
  args?: unknown;
  result?: unknown;
  status?: "running" | "done" | "error";
}

export interface ChatStats {
  completionTokens?: number;
  promptTokens?: number;
  durationMs?: number;
  tokensPerSecond?: number;
}

export interface ChatMessageRecord {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  /** Extended reasoning / thinking text emitted by the model. */
  reasoning?: string;
  /** Name of the model that produced this message. */
  model?: string;
  createdAt?: number;
  /** Files attached to a user message. */
  attachments?: ChatAttachment[];
  /** Tool calls made while producing an assistant message. */
  toolEvents?: ChatToolEvent[];
  /** Generation speed and token counts for this response. */
  stats?: ChatStats;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
}

export interface UploadedFile {
  name: string;
  path: string;
  url: string;
  mime: string;
  size: number;
  sizeStr: string;
  text?: string;
  isText: boolean;
  isImage: boolean;
  kind: AttachmentKind;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessageRecord[];
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface HfResult {
  id: string;
  author: string;
  likes: number;
  downloads: number;
  score: number;
  tags: string[];
  description: string;
}

export interface HfFile {
  filename: string;
  size: number;
}

export interface ProjectorInfo {
  filename: string;
  size: number;
  /** Download job for the projector, or null when it is already saved. */
  job?: DownloadJob | null;
}

export interface DownloadJob {
  id: string;
  repo: string;
  filename: string;
  status: "downloading" | "paused" | "done" | "error" | "cancelled";
  received: number;
  total: number;
  progress: number;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  resumable?: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
}

export interface SystemInfo {
  cpu: number;
  cores: number;
  cpuModel: string;
  ramUsed: number;
  ramTotal: number;
  ramPercent: number;
  platform: string;
  arch: string;
  uptime: number;
  load: number;
}

export interface LlamaStatus {
  state: "stopped" | "starting" | "ready" | "error";
  model: string | null;
  mmproj?: string | null;
  error: string | null;
  warning?: string | null;
  gpuLayers?: number | null;
  flashAttention?: boolean | null;
  cpuFallback?: boolean;
  loaded: boolean;
}

export interface ToastItem {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
}
