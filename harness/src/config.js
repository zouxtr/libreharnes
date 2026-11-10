'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const MODELS_DIR = path.join(ROOT, 'models');
const SANDBOX_DIR = path.join(ROOT, 'sandbox');
const CHATS_DIR = path.join(ROOT, 'chats');

const DEFAULT_TOOLS = {
  web_search: true,
  read_html: true,
  list_files: true,
  read_file: true,
  create_file: true,
};

/**
 * Best guess at physical CPU cores. llama.cpp performs better when the thread
 * count matches physical cores rather than logical (SMT) threads. On a
 * 6-core / 12-thread Ryzen this returns 6.
 */
function defaultThreads() {
  const logical = (os.cpus() || []).length || 4;
  if (logical > 4 && logical % 2 === 0) return Math.max(2, logical / 2);
  return logical;
}

const SERVER_BIN =
  process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

const DEFAULTS = {
  port: 3030,
  host: '127.0.0.1',
  // Path to the llama.cpp server binary (built from source or release)
  llamaServer: path.join(ROOT, 'llama.cpp', 'build', 'bin', SERVER_BIN),
  llamaPort: 8080,
  // Backend used by scripts/setup-llama.js: auto | vulkan | cpu | metal
  llamaBackend: 'auto',
  // Local GGUF model to load (relative to ROOT or absolute)
  model: '',
  // Per-model vision projector pairing. Maps a model filename to its
  // mmproj-*.gguf path, so a projector is only ever used with the model it
  // was downloaded for. This is filled in when a model + projector are
  // installed together.
  modelProjectors: {},
  // Legacy single-projector setting. Migrated into modelProjectors on load.
  mmproj: '',
  // How many model layers to offload to the GPU. 99 = all layers.
  // Set to 0 to force CPU-only inference.
  gpuLayers: 99,
  // Flash attention is a big win on Vulkan/Metal and is safe on CPU.
  flashAttention: true,
  // Vision models need a larger context (images consume many tokens).
  contextSize: 8192,
  threads: defaultThreads(),
  // External OpenAI-compatible endpoints (used when no local model)
  endpoints: [],
  // Currently selected endpoint name ('local' or one of endpoints[].name)
  activeEndpoint: 'local',
  // API key for the local llama-server (optional)
  localApiKey: '',
  // Tavily API key for the web_search tool (optional)
  tavilyKey: '',
  // Temperature / top_p defaults
  temperature: 0.7,
  topP: 0.95,
  // Reasoning effort: default | low | high | disabled
  thinkingEffort: 'default',
  // Max tokens per response
  maxTokens: 2048,
  // Which built-in tools the model may call
  toolsEnabled: { ...DEFAULT_TOOLS },
  // Local model file names the user has starred (favorites)
  starredModels: [],
  // Optional system prompt
  systemPrompt: '',
};

function ensureDirs() {
  if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });
  if (!fs.existsSync(SANDBOX_DIR)) fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  if (!fs.existsSync(CHATS_DIR)) fs.mkdirSync(CHATS_DIR, { recursive: true });
}

function load() {
  ensureDirs();
  let cfg = { ...DEFAULTS, toolsEnabled: { ...DEFAULT_TOOLS } };
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      cfg = { ...cfg, ...parsed };
      cfg.toolsEnabled = { ...DEFAULT_TOOLS, ...(parsed.toolsEnabled || {}) };
      if (parsed.endpoints) {
        cfg.endpoints = parsed.endpoints.map(e => ({
          name: e.name || 'external',
          baseUrl: e.baseUrl || '',
          key: e.key || '',
          model: e.model || '',
          type: e.type || 'external',
        }));
      }
      if (Array.isArray(parsed.starredModels)) {
        cfg.starredModels = parsed.starredModels.filter(n => typeof n === 'string');
      }
      if (parsed.modelProjectors && typeof parsed.modelProjectors === 'object') {
        cfg.modelProjectors = {};
        for (const [model, projector] of Object.entries(parsed.modelProjectors)) {
          if (typeof model === 'string' && typeof projector === 'string' && projector) {
            cfg.modelProjectors[model] = projector;
          }
        }
      }
    } catch (err) {
      console.warn('[config] Could not parse config.json, using defaults:', err.message);
    }
  }

  // Migrate the old global projector setting into a per-model pairing. Only
  // keep it when it actually belongs to the configured model; otherwise the
  // projector would be passed to unrelated text models.
  if (cfg.mmproj && cfg.model) {
    const modelPath = resolveModelPath(cfg.model);
    const projectorPath = resolveModelPath(cfg.mmproj);
    if (
      fs.existsSync(projectorPath) &&
      projectorMatchesModel(projectorPath, modelPath)
    ) {
      cfg.modelProjectors = {
        ...cfg.modelProjectors,
        [path.basename(cfg.model)]: cfg.mmproj,
      };
    }
  }
  cfg.mmproj = '';
  return cfg;
}

function save(cfg) {
  ensureDirs();
  const modelProjectors = {};
  for (const [model, projector] of Object.entries(cfg.modelProjectors || {})) {
    if (typeof model === 'string' && typeof projector === 'string' && projector) {
      modelProjectors[model] = projector;
    }
  }
  const merged = {
    ...DEFAULTS,
    ...cfg,
    modelProjectors,
    toolsEnabled: { ...DEFAULT_TOOLS, ...(cfg.toolsEnabled || {}) },
    starredModels: Array.isArray(cfg.starredModels)
      ? [...new Set(cfg.starredModels.filter(n => typeof n === 'string'))]
      : [],
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function resolveModelPath(model) {
  if (!model) return null;
  if (path.isAbsolute(model)) return model;
  return path.join(ROOT, model);
}

function getActiveBase(cfg) {
  if (cfg.activeEndpoint === 'local') return null;
  const ep = (cfg.endpoints || []).find(e => e.name === cfg.activeEndpoint);
  return ep ? ep : null;
}

// ---- Vision projectors (mmproj) ----

function isProjectorFile(name) {
  return /\.gguf$/i.test(name) && /mmproj/i.test(name);
}

/** Significant lowercase tokens used to match a model with its projector. */
function projectorTokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.gguf$/i, '')
    .replace(/mmproj/g, ' ')
    .replace(/(iq|q)\d+(_[a-z0-9]+)*/g, ' ')
    .replace(/\b(f16|f32|bf16|fp16|fp32)\b/g, ' ')
    .split(/[^a-z0-9.]+/)
    .filter(
      t =>
        t.length >= 2 &&
        !['it', 'instruct', 'chat', 'model', 'gguf', 'vision'].includes(t),
    );
}

/** True when a projector filename clearly belongs to a model filename. */
function projectorMatchesModel(projectorPath, modelPath) {
  if (!projectorPath || !modelPath) return false;
  const modelTokens = new Set(projectorTokens(path.basename(modelPath)));
  const projectorTokensList = projectorTokens(path.basename(projectorPath));
  return projectorTokensList.filter(token => modelTokens.has(token)).length >= 2;
}

/**
 * Resolve the projector paired with this exact model. A projector is never
 * shared across models: only the explicit per-model pairing is used.
 */
function resolveMmproj(cfg, modelPath) {
  if (!modelPath) return null;
  const base = path.basename(modelPath);
  const paired = cfg && cfg.modelProjectors
    ? cfg.modelProjectors[base]
    : null;
  if (paired) {
    const projectorPath = resolveModelPath(paired);
    if (fs.existsSync(projectorPath)) return projectorPath;
  }
  // Legacy fallback for an old config that still has the global setting.
  const configured = cfg && cfg.mmproj ? resolveModelPath(cfg.mmproj) : null;
  if (
    configured &&
    fs.existsSync(configured) &&
    projectorMatchesModel(configured, modelPath)
  ) {
    return configured;
  }
  return null;
}

// ---- Chat persistence ----
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part && part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join(' ')
      .trim();
  }
  return '';
}

function deriveChatTitle(messages) {
  const first = (messages || []).find(
    m => m.role === 'user' && contentToText(m.content).trim(),
  );
  if (!first) return 'New chat';
  const words = contentToText(first.content).trim().replace(/\s+/g, ' ').split(' ');
  return words.slice(0, 5).join(' ').slice(0, 60).trim();
}

function chatPath(id) {
  return path.join(CHATS_DIR, id + '.json');
}

function listChats() {
  ensureDirs();
  const chats = [];
  if (!fs.existsSync(CHATS_DIR)) return chats;
  for (const f of fs.readdirSync(CHATS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(CHATS_DIR, f), 'utf8');
      const c = JSON.parse(raw);
      chats.push({
        id: c.id,
        title:
          c.title && c.title !== 'New chat'
            ? c.title
            : deriveChatTitle(c.messages),
        updatedAt: c.updatedAt || c.createdAt || 0,
        createdAt: c.createdAt || 0,
        messageCount: (c.messages || []).length,
        model: c.model || '',
      });
    } catch (e) {
      // skip corrupt chat files
    }
  }
  chats.sort((a, b) => b.updatedAt - a.updatedAt);
  return chats;
}

function readChat(id) {
  const p = chatPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeChat(chat) {
  ensureDirs();
  chat.updatedAt = Date.now();
  if (!chat.createdAt) chat.createdAt = chat.updatedAt;
  fs.writeFileSync(chatPath(chat.id), JSON.stringify(chat, null, 2), 'utf8');
  return chat;
}

function newChatId() {
  return 'chat_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

module.exports = {
  ROOT,
  CONFIG_PATH,
  MODELS_DIR,
  SANDBOX_DIR,
  CHATS_DIR,
  DEFAULTS,
  DEFAULT_TOOLS,
  load,
  save,
  resolveModelPath,
  getActiveBase,
  isProjectorFile,
  projectorTokens,
  projectorMatchesModel,
  resolveMmproj,
  contentToText,
  deriveChatTitle,
  chatPath,
  listChats,
  readChat,
  writeChat,
  newChatId,
};
