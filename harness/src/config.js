'use strict';

const fs = require('fs');
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

const DEFAULTS = {
  port: 3030,
  host: '127.0.0.1',
  // Path to the llama.cpp server binary (built from source or release)
  llamaServer: path.join(ROOT, 'llama.cpp', 'build', 'bin', 'llama-server'),
  llamaPort: 8080,
  // Local GGUF model to load (relative to ROOT or absolute)
  model: '',
  contextSize: 2048,
  threads: 4,
  // External OpenAI-compatible endpoints (used when no local model)
  endpoints: [],
  // Currently selected endpoint name ('local' or one of endpoints[].name)
  activeEndpoint: 'local',
  // API key for the local llama-server (optional)
  localApiKey: '',
  // Temperature / top_p defaults
  temperature: 0.7,
  topP: 0.95,
  // Reasoning effort: default | low | high | disabled
  thinkingEffort: 'default',
  // Max tokens per response
  maxTokens: 1024,
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
    } catch (err) {
      console.warn('[config] Could not parse config.json, using defaults:', err.message);
    }
  }
  return cfg;
}

function save(cfg) {
  ensureDirs();
  const merged = {
    ...DEFAULTS,
    ...cfg,
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

// ---- Chat persistence ----
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
        title: c.title || 'New chat',
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
  chatPath,
  listChats,
  readChat,
  writeChat,
  newChatId,
};
