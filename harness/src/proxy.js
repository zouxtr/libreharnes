'use strict';

// OpenAI-compatible reverse proxy + tool-calling loop.
// Forwards chat completions to either a local llama.cpp server or an
// external OpenAI-compatible endpoint (OpenRouter, Together, etc.).
// Handles simple tool execution: web_search, read_html, list_files, read_file, create_file.

const fetch = globalThis.fetch;
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  load,
  getActiveBase,
  resolveModelPath,
  resolveMmproj,
} = require('./config');
const { search } = require('./tools/search');
const { readHtml } = require('./tools/html');
const { list: fsList, read: fsRead, create: fsCreate } = require('./tools/fs');

// Tool name -> handler
const TOOLS = {
  web_search: ({ query, engine, braveKey, tavilyKey }) => search(query, { engine, braveKey, tavilyKey }),
  read_html: ({ url, maxChars }) => readHtml(url, { maxChars }),
  list_files: () => fsList(),
  read_file: ({ path: p }) => fsRead(p),
  create_file: ({ path: p, content }) => fsCreate(p, content),
};

// JSON schema describing available tools (OpenAI function-calling format).
const TOOL_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo (default), Brave or Tavily. API-backed engines are used when their key is configured.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          engine: { type: 'string', enum: ['ddg', 'brave', 'tavily'], description: 'Search engine' },
          braveKey: { type: 'string', description: 'Brave API key (only needed for brave engine)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_html',
      description: 'Fetch a webpage and extract readable text.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          maxChars: { type: 'number', description: 'Max characters to return' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in the sandbox directory.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the sandbox directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path relative to sandbox' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a file in the sandbox directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to sandbox' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// llama-server lifecycle
// ---------------------------------------------------------------------------

let llamaProc = null;
let llamaModelPath = null;
let llamaMmprojPath = null;
let llamaState = 'stopped'; // stopped | starting | ready | error
let llamaError = null;
let llamaLog = '';
let llamaWarning = null;
let llamaGpuLayers = null;
let llamaFlashAttention = null;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function stopLlama() {
  if (llamaProc && !llamaProc.killed) {
    try { llamaProc.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }
  llamaProc = null;
  llamaModelPath = null;
  llamaMmprojPath = null;
  llamaState = 'stopped';
  llamaError = null;
  llamaLog = '';
  llamaWarning = null;
  llamaGpuLayers = null;
  llamaFlashAttention = null;
}

function llamaStatus() {
  return {
    state: llamaState,
    model: llamaModelPath,
    mmproj: llamaMmprojPath,
    error: llamaError,
    warning: llamaWarning,
    gpuLayers: llamaGpuLayers,
    flashAttention: llamaFlashAttention,
    cpuFallback: llamaGpuLayers === 0 && llamaWarning !== null,
  };
}

function logTail(log, max = 1500) {
  const text = String(log || '').trim();
  return text ? '\n\n' + text.slice(-max) : '';
}

/**
 * Turn a raw llama-server failure into a message that explains what the user
 * can do. Windows GPU builds commonly fail because Vulkan (or one of its
 * DLLs) is unavailable, which used to surface as an opaque crash.
 */
function friendlyLlamaFailure(message, code, log) {
  const tail = logTail(log);
  if (process.platform === 'win32') {
    if (code === -1073741515 || code === 3221225781) {
      return (
        'llama-server could not start because a required DLL is missing. ' +
        'Update your graphics driver, or reinstall LibreHarnes with the CPU-only build.' +
        tail
      );
    }
    if (
      /vulkan/i.test(log || '') &&
      /(no vulkan|not found|failed to initialize|could not find|error)/i.test(log || '')
    ) {
      return (
        'The GPU (Vulkan) build of llama.cpp could not initialize on this PC. ' +
        'LibreHarnes will try the CPU instead.' +
        tail
      );
    }
  }
  return message + tail;
}

function enabledTools(cfg) {
  const map = cfg.toolsEnabled || {};
  return TOOL_SCHEMA.filter(t => map[t.function.name] !== false);
}

/** Start llama-server with the given arguments and wait until it is healthy. */
async function launchLlama(server, args, base) {
  let spawnError = null;

  llamaState = 'starting';
  llamaError = null;
  llamaLog = '';

  const proc = spawn(server, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  llamaProc = proc;

  const append = d => {
    llamaLog += d.toString();
    if (llamaLog.length > 20000) llamaLog = llamaLog.slice(-20000);
  };
  proc.stdout.on('data', append);
  proc.stderr.on('data', append);
  proc.on('error', err => {
    spawnError = err;
    append(Buffer.from('spawn error: ' + err.message + '\n'));
  });

  proc.on('exit', code => {
    if (llamaProc === proc) {
      llamaProc = null;
      if (llamaState !== 'stopped') {
        llamaState = 'error';
        if (!llamaError) {
          llamaError = friendlyLlamaFailure(
            'llama-server exited with code ' + code,
            code,
            llamaLog,
          );
        }
      }
    }
  });

  // Wait for the server to become healthy (model loading can take a while on CPU).
  for (let i = 0; i < 300; i++) {
    if (spawnError) {
      throw new Error(
        friendlyLlamaFailure(
          'Could not start llama-server: ' + spawnError.message,
          null,
          llamaLog,
        ),
      );
    }
    if (proc.exitCode !== null) {
      throw new Error(
        friendlyLlamaFailure(
          'llama-server exited while loading the model (code ' + proc.exitCode + ')',
          proc.exitCode,
          llamaLog,
        ),
      );
    }
    try {
      const res = await fetch(base + '/health');
      if (res.ok) {
        llamaState = 'ready';
        return llamaStatus();
      }
    } catch (e) {
      // not ready yet
    }
    await sleep(500);
  }

  throw new Error(
    friendlyLlamaFailure(
      'Timed out waiting for llama-server to load the model.',
      null,
      llamaLog,
    ),
  );
}

async function startLlama(modelPath) {
  const cfg = load();

  if (!modelPath || !fs.existsSync(modelPath)) {
    throw new Error('Model file not found: ' + (modelPath || '(none)'));
  }
  const stat = fs.statSync(modelPath);
  if (stat.size < 1024 * 1024) {
    throw new Error('Model file is too small to be valid (' + stat.size + ' bytes). It may be incomplete.');
  }

  // Already running the same model.
  if (llamaState === 'ready' && llamaModelPath === modelPath && llamaProc && !llamaProc.killed) {
    return llamaStatus();
  }

  stopLlama();

  const server = cfg.llamaServer;
  if (!fs.existsSync(server)) {
    throw new Error('llama-server not found at ' + server + '. Build llama.cpp first (see scripts/build-llama.sh).');
  }

  // Vision models need their multimodal projector loaded alongside the model.
  const mmproj = resolveMmproj(cfg, modelPath);
  if (mmproj && !fs.existsSync(mmproj)) {
    throw new Error('Multimodal projector not found: ' + mmproj);
  }

  const port = cfg.llamaPort || 8080;
  const base = 'http://127.0.0.1:' + port;
  const configuredGpuLayers =
    Number.isFinite(Number(cfg.gpuLayers)) && cfg.gpuLayers !== null
      ? Number(cfg.gpuLayers)
      : 99;
  const configuredFlash = cfg.flashAttention !== false;

  const argsFor = (gpuLayers, flashAttention) => {
    const args = [
      '-m', modelPath,
      '-c', String(cfg.contextSize || 8192),
      '--threads', String(cfg.threads || 6),
      '-ngl', String(gpuLayers),
      '--host', '127.0.0.1',
      '--port', String(port),
      '--jinja',
    ];
    // --flash-attn takes a value (on|off|auto). Passing it bare makes
    // llama-server exit on argument parsing, which looked like a GPU failure.
    args.push('--flash-attn', flashAttention ? 'on' : 'off');
    if (mmproj) args.push('--mmproj', mmproj);
    if (cfg.localApiKey) args.push('--api-key', cfg.localApiKey);
    return args;
  };

  llamaModelPath = modelPath;
  llamaMmprojPath = mmproj;

  try {
    await launchLlama(
      server,
      argsFor(configuredGpuLayers, configuredFlash),
      base,
    );
    llamaGpuLayers = configuredGpuLayers;
    llamaFlashAttention = configuredFlash;
    llamaWarning = null;
    return llamaStatus();
  } catch (primaryError) {
    const primaryMessage = primaryError.message;

    // A CPU-only install (or an explicit gpuLayers: 0) has nothing to retry.
    if (configuredGpuLayers <= 0) {
      stopLlama();
      llamaState = 'error';
      llamaError = primaryMessage;
      throw primaryError;
    }

    // GPU offload can fail for reasons outside the model: missing Vulkan
    // runtime, an outdated driver, or not enough VRAM. The Vulkan build also
    // contains the CPU backend, so retry with GPU offload disabled instead of
    // leaving the user with a raw crash.
    stopLlama();
    llamaModelPath = modelPath;
    llamaMmprojPath = mmproj;

    try {
      await launchLlama(server, argsFor(0, false), base);
      llamaGpuLayers = 0;
      llamaFlashAttention = false;
      llamaWarning =
        'GPU acceleration failed, so the model was loaded on the CPU. ' +
        'Update your graphics driver, or reinstall LibreHarnes with the CPU-only build to skip this retry.';
      return llamaStatus();
    } catch (fallbackError) {
      stopLlama();
      llamaState = 'error';
      llamaError =
        'The model could not be loaded with the GPU or the CPU.\n\n' +
        'GPU attempt: ' + primaryMessage + '\n\n' +
        'CPU attempt: ' + fallbackError.message;
      throw new Error(llamaError);
    }
  }
}

async function ensureLlamaServer(modelPath) {
  return startLlama(modelPath);
}

function resolveTarget(cfg) {
  const isLocal = cfg.activeEndpoint === 'local';
  if (isLocal) {
    const modelPath = resolveModelPath(cfg.model);
    if (!modelPath || !fs.existsSync(modelPath)) {
      throw new Error('No local GGUF model selected. Download one from Models or pick a local model.');
    }
    const port = cfg.llamaPort || 8080;
    return {
      isLocal: true,
      url: 'http://127.0.0.1:' + port + '/v1/chat/completions',
      key: cfg.localApiKey,
      modelPath,
      model: cfg.model || 'local',
    };
  }
  const base = getActiveBase(cfg);
  if (!base || !base.baseUrl) {
    throw new Error('No active endpoint configured. Add one in Settings or switch to a local model.');
  }
  const upstream = base.baseUrl.endsWith('/') ? base.baseUrl : base.baseUrl + '/';
  return {
    isLocal: false,
    url: upstream + 'v1/chat/completions',
    key: base.key,
    model: base.model || cfg.model || 'local',
    endpointName: base.name,
  };
}

function buildBody(cfg, messages, opts, stream, modelOverride) {
  const tools = enabledTools(cfg);
  const body = {
    model: modelOverride || cfg.model || 'local',
    messages,
    temperature: opts.temperature ?? cfg.temperature ?? 0.7,
    top_p: opts.topP ?? cfg.topP ?? 0.95,
    max_tokens: opts.maxTokens ?? cfg.maxTokens ?? 1024,
    stream: !!stream,
  };
  if (stream) {
    // Ask OpenAI-compatible servers for a final usage/timings chunk so the UI
    // can show accurate tokens-per-second for the response.
    body.stream_options = { include_usage: true };
  }
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const effort = opts.thinkingEffort ?? cfg.thinkingEffort ?? 'default';
  if (effort !== 'default') {
    // Best-effort across runtimes.
    body.reasoning_effort = effort === 'disabled' ? 'low' : effort;
    body.chat_template_kwargs = { enable_thinking: effort !== 'disabled' };
  }
  return body;
}

function authHeaders(key) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (key) headers['Authorization'] = 'Bearer ' + key;
  return headers;
}

async function executeTool(name, args) {
  const handler = TOOLS[name];
  if (!handler) return { error: 'Unknown tool: ' + name };
  const callArgs = { ...(args || {}) };
  // The Tavily key lives in config, never in the tool schema sent to the model.
  if (name === 'web_search' && !callArgs.tavilyKey) {
    callArgs.tavilyKey = load().tavilyKey || '';
  }
  try {
    return await handler(callArgs);
  } catch (err) {
    return { error: err.message };
  }
}

// Run a full chat completion (non-streaming) with tool-calling loop.
async function chatCompletion(messages, opts = {}) {
  const cfg = load();
  const target = resolveTarget(cfg);
  if (target.isLocal) await ensureLlamaServer(target.modelPath);

  let current = [...messages];
  let toolRound = 0;
  const maxToolRounds = 6;

  while (toolRound < maxToolRounds) {
    toolRound++;
    const body = buildBody(cfg, current, opts, false, target.model);
    const res = await fetch(target.url, {
      method: 'POST',
      headers: authHeaders(target.key),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('Upstream error ' + res.status + (text ? ': ' + text.slice(0, 500) : ''));
    }
    const data = await res.json();
    const choice = (data.choices || [])[0] || {};
    const msg = choice.message || {};

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const reasoning =
        msg.reasoning_content || msg.reasoning || msg.thinking || '';
      return {
        content: msg.content || '',
        reasoning,
        model: data.model || cfg.model || 'local',
        usage: data.usage || {},
      };
    }

    current.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      const fn = call.function || {};
      let args = {};
      try { args = JSON.parse(fn.arguments || '{}'); } catch (e) { args = {}; }
      const result = await executeTool(fn.name, args);
      current.push({
        role: 'tool',
        tool_call_id: call.id,
        name: fn.name,
        content: JSON.stringify(result),
      });
    }
  }

  return { content: '(stopped after max tool rounds)', usage: {} };
}

// Run a streaming chat completion with tool-calling loop.
// onEvent({type:'delta', content}) for text deltas;
// onEvent({type:'tool', name, args, result}) when a tool runs.
async function streamChatCompletion(messages, opts = {}, onEvent = () => {}) {
  const cfg = load();
  const target = resolveTarget(cfg);
  if (target.isLocal) await ensureLlamaServer(target.modelPath);

  let current = [...messages];
  let toolRound = 0;
  const maxToolRounds = 6;
  let fullContent = '';
  let fullReasoning = '';
  let responseModel = '';
  let usage = null;
  let timings = null;
  let firstTokenAt = 0;
  let lastTokenAt = 0;

  const buildStats = () => {
    const completionTokens =
      (timings && timings.predicted_n) ||
      (usage && usage.completion_tokens) ||
      undefined;
    const promptTokens =
      (timings && timings.prompt_n) ||
      (usage && usage.prompt_tokens) ||
      undefined;
    const predictedMs =
      (timings && timings.predicted_ms) ||
      (firstTokenAt && lastTokenAt ? lastTokenAt - firstTokenAt : undefined);
    const tokensPerSecond =
      timings && timings.predicted_per_second
        ? timings.predicted_per_second
        : completionTokens && predictedMs
          ? completionTokens / (predictedMs / 1000)
          : undefined;
    return {
      completionTokens: completionTokens || undefined,
      promptTokens: promptTokens || undefined,
      durationMs: predictedMs ? Math.round(predictedMs) : undefined,
      tokensPerSecond:
        tokensPerSecond && isFinite(tokensPerSecond)
          ? Math.round(tokensPerSecond * 10) / 10
          : undefined,
    };
  };

  while (toolRound < maxToolRounds) {
    toolRound++;
    usage = null;
    timings = null;
    firstTokenAt = 0;
    lastTokenAt = 0;
    const body = buildBody(cfg, current, opts, true, target.model);
    const res = await fetch(target.url, {
      method: 'POST',
      headers: authHeaders(target.key),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('Upstream error ' + res.status + (text ? ': ' + text.slice(0, 500) : ''));
    }
    if (!res.body) throw new Error('Upstream returned no body');

    let content = '';
    const toolCalls = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let json;
          try { json = JSON.parse(payload); } catch (e) { continue; }
          if (json.model) responseModel = json.model;
          if (json.usage) usage = json.usage;
          if (json.timings) timings = json.timings;
          const choice = (json.choices || [])[0] || {};
          const delta = choice.delta || {};
          if (delta.content) {
            content += delta.content;
            fullContent += delta.content;
            const now = Date.now();
            if (!firstTokenAt) firstTokenAt = now;
            lastTokenAt = now;
            onEvent({ type: 'delta', content: delta.content });
          }
          const reasoningDelta =
            delta.reasoning_content || delta.reasoning || delta.thinking;
          if (reasoningDelta) {
            fullReasoning += reasoningDelta;
            const now = Date.now();
            if (!firstTokenAt) firstTokenAt = now;
            lastTokenAt = now;
            onEvent({ type: 'reasoning', content: reasoningDelta });
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
              }
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function && tc.function.name) toolCalls[idx].function.name += tc.function.name;
              if (tc.function && tc.function.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const calls = toolCalls.filter(Boolean);
    if (calls.length === 0) {
      return {
        content: fullContent,
        reasoning: fullReasoning,
        model: responseModel || cfg.model || 'local',
        usage: usage || {},
        timings: timings || undefined,
        stats: buildStats(),
      };
    }

    current.push({ role: 'assistant', content, tool_calls: calls });
    for (const call of calls) {
      const fn = call.function || {};
      let args = {};
      try { args = JSON.parse(fn.arguments || '{}'); } catch (e) { args = {}; }
      onEvent({ type: 'tool', name: fn.name, args });
      const result = await executeTool(fn.name, args);
      onEvent({ type: 'tool_result', name: fn.name, result });
      current.push({
        role: 'tool',
        tool_call_id: call.id,
        name: fn.name,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    content: fullContent,
    reasoning: fullReasoning,
    model: responseModel || cfg.model || 'local',
    usage: usage || {},
    timings: timings || undefined,
    stats: buildStats(),
  };
}

module.exports = {
  chatCompletion,
  streamChatCompletion,
  stopLlama,
  startLlama,
  llamaStatus,
  executeTool,
  TOOL_SCHEMA,
};
