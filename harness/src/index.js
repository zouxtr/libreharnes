#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');

const {
  ROOT,
  load,
  save,
  resolveModelPath,
  MODELS_DIR,
  SANDBOX_DIR,
  listChats,
  readChat,
  writeChat,
  newChatId,
  deriveChatTitle,
  isProjectorFile,
  projectorMatchesModel,
  resolveMmproj,
  contentToText,
} = require('./config');
const {
  chatCompletion,
  streamChatCompletion,
  stopLlama,
  startLlama,
  llamaStatus,
  executeTool,
  TOOL_SCHEMA,
} = require('./proxy');
const {
  searchModels,
  listGgufFiles,
  findProjector,
  findRepoForModel,
  startDownload,
  downloadGguf,
  getJob,
  listJobs,
  cancelJob,
  resumeJob,
  removeJob,
  formatSize,
} = require('./hf');

let cfg = load();

const WEB_ROOT = path.join(ROOT, 'web');
const DIST_ROOT = path.join(ROOT, 'frontend', 'dist');
const PORT = cfg.port || 3030;
const HOST = cfg.host || '127.0.0.1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(res, code, obj, type = 'application/json') {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Invalid JSON body');
  }
}

function readRawBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        reject(new Error('File is too large (max 32 MB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', err => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

function isProbablyText(buf) {
  if (!buf.length) return true;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return false;
  // Count replacement characters that would appear in binary data.
  const text = sample.toString('utf8');
  let bad = 0;
  for (const ch of text) {
    if (ch === '\uFFFD') bad++;
  }
  return bad / Math.max(1, text.length) < 0.02;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Formats llama.cpp's stb_image can decode. SVG is intentionally excluded.
const IMAGE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
]);

function serveFile(res, root, pathname) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, safePath);
  if (!filePath.startsWith(root)) return send(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function serveStatic(req, res, pathname) {
  // Prefer the built React app, fall back to the legacy vanilla UI.
  const root = fs.existsSync(DIST_ROOT) ? DIST_ROOT : WEB_ROOT;
  const rel = pathname === '/' ? '/index.html' : pathname;
  if (serveFile(res, root, rel)) return true;
  // SPA fallback for client-side routes.
  if (fs.existsSync(path.join(root, 'index.html'))) {
    return serveFile(res, root, '/index.html');
  }
  return false;
}

// ---------------------------------------------------------------------------
// System stats
// ---------------------------------------------------------------------------

let prevCpuTimes = os.cpus().map(c => c.times);

function cpuPercent() {
  const current = os.cpus().map(c => c.times);
  let idle = 0;
  let total = 0;
  for (let i = 0; i < current.length; i++) {
    const prev = prevCpuTimes[i] || current[i];
    const cur = current[i];
    idle += cur.idle - prev.idle;
    total +=
      (cur.user - prev.user) +
      (cur.nice - prev.nice) +
      (cur.sys - prev.sys) +
      (cur.idle - prev.idle) +
      (cur.irq - prev.irq);
  }
  prevCpuTimes = current;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
}

function systemInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  return {
    cpu: cpuPercent(),
    cores: os.cpus().length,
    cpuModel: (os.cpus()[0] && os.cpus()[0].model) || 'CPU',
    ramUsed: usedMem,
    ramTotal: totalMem,
    ramPercent: Math.round((usedMem / totalMem) * 100),
    platform: os.platform(),
    arch: os.arch(),
    uptime: Math.round(os.uptime()),
    load: os.loadavg()[0],
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function configResponse() {
  const status = llamaStatus();
  return {
    port: cfg.port,
    host: cfg.host,
    model: cfg.model,
    contextSize: cfg.contextSize,
    threads: cfg.threads,
    llamaPort: cfg.llamaPort,
    activeEndpoint: cfg.activeEndpoint,
    endpoints: cfg.endpoints || [],
    localApiKey: !!cfg.localApiKey,
    hasTavilyKey: !!cfg.tavilyKey,
    hasLocalModel: Boolean(cfg.model && fs.existsSync(resolveModelPath(cfg.model))),
    llamaServer: cfg.llamaServer,
    llamaBackend: cfg.llamaBackend || 'auto',
    gpuLayers: cfg.gpuLayers,
    flashAttention: cfg.flashAttention !== false,
    mmproj: cfg.mmproj || '',
    modelProjectors: cfg.modelProjectors || {},
    temperature: cfg.temperature,
    topP: cfg.topP,
    maxTokens: cfg.maxTokens,
    thinkingEffort: cfg.thinkingEffort,
    toolsEnabled: cfg.toolsEnabled,
    starredModels: cfg.starredModels || [],
    systemPrompt: cfg.systemPrompt || '',
    loaded: status.state === 'ready',
    llamaState: status.state,
    llamaError: status.error,
    llamaWarning: status.warning || null,
    llamaGpuLayers: status.gpuLayers,
    llamaCpuFallback: !!status.cpuFallback,
    loadedMmproj: status.mmproj || '',
    visionReady: Boolean(
      cfg.model &&
        fs.existsSync(resolveModelPath(cfg.model)) &&
        resolveMmproj(cfg, resolveModelPath(cfg.model)),
    ),
  };
}

async function handle(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 204, '');

  // ---- Launcher window ----
  if (req.method === 'GET' && (pathname === '/launcher' || pathname === '/launcher/')) {
    if (serveFile(res, WEB_ROOT, '/launcher.html')) return;
    return send(res, 404, { error: 'launcher page not found' });
  }

  // ---- Static UI ----
  if (req.method === 'GET' && !pathname.startsWith('/api') && !pathname.startsWith('/v1')) {
    if (serveStatic(req, res, pathname)) return;
  }

  try {
    // ---- Config ----
    if (pathname === '/api/config' && req.method === 'GET') {
      return send(res, 200, configResponse());
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      const body = await readJson(req);
      const oldModel = cfg.model;
      const oldCtx = cfg.contextSize;
      const oldThreads = cfg.threads;
      const oldPort = cfg.llamaPort;
      const oldGpuLayers = cfg.gpuLayers;
      const oldFlash = cfg.flashAttention;
      const oldMmproj = cfg.mmproj;
      const oldProjectors = JSON.stringify(cfg.modelProjectors || {});

      // Older clients send a single global projector. Convert it into a
      // pairing for the active model instead of applying it to everything.
      if (Object.prototype.hasOwnProperty.call(body, 'mmproj')) {
        const selected = String(body.mmproj || '');
        const activeModel = body.model ? String(body.model) : cfg.model;
        const activeBase = activeModel ? path.basename(activeModel) : '';
        const pairings = { ...(cfg.modelProjectors || {}) };
        if (activeBase) {
          if (selected) {
            const projectorPath = resolveModelPath(selected);
            if (!fs.existsSync(projectorPath)) {
              return send(res, 404, {
                error: 'Projector not found: ' + selected,
              });
            }
            const alreadyPaired = pairings[activeBase] === selected;
            if (
              !alreadyPaired &&
              !projectorMatchesModel(
                projectorPath,
                resolveModelPath(activeModel),
              )
            ) {
              return send(res, 400, {
                error:
                  'That projector does not match ' +
                  activeBase +
                  '. Choose the mmproj from the same model family.',
              });
            }
            pairings[activeBase] = selected;
          } else {
            delete pairings[activeBase];
          }
        }
        body.modelProjectors = pairings;
        body.mmproj = '';
      }

      cfg = save({ ...cfg, ...body });
      if (
        cfg.model !== oldModel ||
        cfg.contextSize !== oldCtx ||
        cfg.threads !== oldThreads ||
        cfg.llamaPort !== oldPort ||
        cfg.gpuLayers !== oldGpuLayers ||
        cfg.flashAttention !== oldFlash ||
        cfg.mmproj !== oldMmproj ||
        JSON.stringify(cfg.modelProjectors || {}) !== oldProjectors
      ) {
        stopLlama();
      }
      return send(res, 200, { ok: true, config: configResponse() });
    }

    // ---- System / status ----
    if (pathname === '/api/system' && req.method === 'GET') {
      return send(res, 200, systemInfo());
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      return send(res, 200, { ...llamaStatus(), loaded: llamaStatus().state === 'ready', config: configResponse() });
    }

    // ---- Uploads ----
    if (pathname === '/api/upload' && req.method === 'POST') {
      const rawName = String(parsed.query.name || '');
      const safeName = path
        .basename(rawName)
        .replace(/[^\w.\- ()[\]]+/g, '_')
        .slice(0, 180);
      if (!safeName || safeName === '.' || safeName === '..') {
        return send(res, 400, { error: 'name query parameter required' });
      }

      const buf = await readRawBody(req);
      if (!buf.length) return send(res, 400, { error: 'file is empty' });

      const uploadsDir = path.join(SANDBOX_DIR, 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });

      const ext = path.extname(safeName);
      const stem = path.basename(safeName, ext);
      let filename = safeName;
      let counter = 1;
      while (fs.existsSync(path.join(uploadsDir, filename))) {
        filename = `${stem}-${counter++}${ext}`;
      }

      const full = path.join(uploadsDir, filename);
      fs.writeFileSync(full, buf);
      const fileExt = path.extname(filename).toLowerCase();
      const isImage = IMAGE_EXT.has(fileExt) && !isProbablyText(buf);
      const isText = !isImage && isProbablyText(buf);
      const kind = isImage ? 'image' : isText ? 'text' : 'file';
      const text =
        kind === 'text' && buf.length <= 256 * 1024
          ? buf.toString('utf8')
          : undefined;
      return send(res, 200, {
        ok: true,
        file: {
          name: filename,
          path: path.relative(ROOT, full).split(path.sep).join('/'),
          url: '/api/uploads/' + encodeURIComponent(filename),
          mime: MIME[fileExt] || 'application/octet-stream',
          size: buf.length,
          sizeStr: formatSize(buf.length),
          kind,
          isImage,
          isText,
          text,
        },
      });
    }

    // Serve uploaded files (used for image previews and vision input).
    const uploadMatch = pathname.match(/^\/api\/uploads\/([^/]+)$/);
    if (uploadMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const uploadsDir = path.join(SANDBOX_DIR, 'uploads');
      let name;
      try {
        name = decodeURIComponent(uploadMatch[1]);
      } catch (e) {
        return send(res, 400, { error: 'invalid file name' });
      }
      const safeName = path.basename(name);
      const full = path.join(uploadsDir, safeName);
      if (
        !safeName ||
        safeName === '.' ||
        safeName === '..' ||
        !full.startsWith(uploadsDir) ||
        !fs.existsSync(full) ||
        !fs.statSync(full).isFile()
      ) {
        return send(res, 404, { error: 'file not found' });
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': fs.statSync(full).size,
        'Cache-Control': 'private, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(full).pipe(res);
    }

    // ---- Chats ----
    if (pathname === '/api/chats' && req.method === 'GET') {
      return send(res, 200, { chats: listChats() });
    }

    if (pathname === '/api/chats' && req.method === 'POST') {
      const body = await readJson(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const providedTitle =
        typeof body.title === 'string' ? body.title.trim() : '';
      const chat = {
        id: body.id || newChatId(),
        title:
          providedTitle && providedTitle !== 'New chat'
            ? providedTitle
            : deriveChatTitle(messages),
        messages,
        model: body.model || cfg.model || '',
        createdAt: body.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      writeChat(chat);
      return send(res, 200, { ok: true, chat });
    }

    const chatIdMatch = pathname.match(/^\/api\/chats\/([^/]+)$/);
    if (chatIdMatch) {
      const id = chatIdMatch[1];
      if (req.method === 'GET') {
        const chat = readChat(id);
        if (!chat) return send(res, 404, { error: 'chat not found' });
        return send(res, 200, { chat });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await readJson(req);
        const existing = readChat(id);
        if (!existing) return send(res, 404, { error: 'chat not found' });
        const updated = { ...existing, ...body, id };
        writeChat(updated);
        return send(res, 200, { ok: true, chat: updated });
      }
      if (req.method === 'DELETE') {
        const p = path.join(ROOT, 'chats', id + '.json');
        if (fs.existsSync(p)) fs.unlinkSync(p);
        return send(res, 200, { ok: true });
      }
    }

    // ---- Models ----
    if (pathname === '/api/models' && req.method === 'GET') {
      const status = llamaStatus();
      const loadedPath = status.model;
      const files = [];
      const projectors = [];
      if (fs.existsSync(MODELS_DIR)) {
        for (const f of fs.readdirSync(MODELS_DIR)) {
          const full = path.join(MODELS_DIR, f);
          if (!fs.statSync(full).isFile() || !/\.gguf$/i.test(f)) continue;
          const size = fs.statSync(full).size;
          if (isProjectorFile(f)) {
            projectors.push({
              name: f,
              size,
              sizeStr: formatSize(size),
              active: Object.values(cfg.modelProjectors || {}).some(
                projector => path.basename(projector) === f,
              ),
              loaded: status.state === 'ready' && status.mmproj === full,
            });
            continue;
          }
          const pairedProjector = resolveMmproj(cfg, full);
          files.push({
            name: f,
            size,
            sizeStr: formatSize(size),
            active: cfg.model === 'models/' + f,
            loaded: status.state === 'ready' && loadedPath === full,
            starred: (cfg.starredModels || []).includes(f),
            vision: Boolean(pairedProjector),
            projector: pairedProjector
              ? 'models/' + path.basename(pairedProjector)
              : '',
            repo: findRepoForModel(f),
          });
        }
      }
      files.sort((a, b) => a.name.localeCompare(b.name));
      projectors.sort((a, b) => a.name.localeCompare(b.name));
      return send(res, 200, {
        models: files,
        projectors,
        mmproj: cfg.mmproj || '',
        active: cfg.model,
        llamaState: status.state,
        llamaError: status.error,
        llamaWarning: status.warning || null,
        llamaGpuLayers: status.gpuLayers,
        llamaCpuFallback: !!status.cpuFallback,
        loadedMmproj: status.mmproj || '',
      });
    }

    if (pathname === '/api/models/load' && req.method === 'POST') {
      const body = await readJson(req);
      const name = body.name || body.model;
      if (!name) return send(res, 400, { error: 'name required' });
      const base = path.basename(String(name));
      if (isProjectorFile(base)) {
        return send(res, 400, {
          error:
            'That file is a vision projector (mmproj). Select it as the projector instead of loading it as a model.',
        });
      }
      let modelPath = path.isAbsolute(name)
        ? name
        : resolveModelPath('models/' + base);
      // The chat UI may send a display name without the .gguf extension.
      if (!fs.existsSync(modelPath) && !path.extname(modelPath)) {
        const withExt = modelPath + '.gguf';
        if (fs.existsSync(withExt)) modelPath = withExt;
      }
      if (!fs.existsSync(modelPath)) {
        return send(res, 404, {
          error: 'Model file not found: ' + path.basename(modelPath),
        });
      }
      const patch = {
        model: 'models/' + path.basename(modelPath),
        activeEndpoint: 'local',
        mmproj: '',
      };
      if (Object.prototype.hasOwnProperty.call(body, 'mmproj')) {
        const selected = String(body.mmproj || '');
        const pairings = { ...(cfg.modelProjectors || {}) };
        if (selected) {
          const projectorPath = resolveModelPath(selected);
          if (!fs.existsSync(projectorPath)) {
            return send(res, 404, {
              error: 'Projector not found: ' + selected,
            });
          }
          const alreadyPaired =
            pairings[path.basename(modelPath)] === selected;
          if (
            !alreadyPaired &&
            !projectorMatchesModel(projectorPath, modelPath)
          ) {
            return send(res, 400, {
              error:
                'That projector does not match ' +
                path.basename(modelPath) +
                '. Choose the mmproj from the same model family.',
            });
          }
          pairings[path.basename(modelPath)] = selected;
        } else {
          delete pairings[path.basename(modelPath)];
        }
        patch.modelProjectors = pairings;
      }
      // Save first: startLlama() reads config.json to resolve the projector.
      cfg = save({ ...cfg, ...patch });
      try {
        const status = await startLlama(modelPath);
        return send(res, 200, { ok: true, status, config: configResponse() });
      } catch (e) {
        return send(res, 500, { ok: false, error: e.message, status: llamaStatus() });
      }
    }

    if (pathname === '/api/models/unload' && req.method === 'POST') {
      stopLlama();
      return send(res, 200, { ok: true, status: llamaStatus() });
    }

    if (pathname === '/api/models/star' && req.method === 'POST') {
      const body = await readJson(req);
      const base = path.basename(String(body.name || ''));
      if (!base) return send(res, 400, { error: 'name required' });
      let starred = Array.isArray(cfg.starredModels) ? [...cfg.starredModels] : [];
      if (body.starred) {
        if (!starred.includes(base)) starred.push(base);
      } else {
        starred = starred.filter(n => n !== base);
      }
      cfg = save({ ...cfg, starredModels: starred });
      return send(res, 200, { ok: true, starredModels: cfg.starredModels });
    }

    if (pathname === '/api/models/delete' && req.method === 'POST') {
      const body = await readJson(req);
      const name = body.name;
      if (!name) return send(res, 400, { error: 'name required' });
      const base = path.basename(name);
      const full = path.join(MODELS_DIR, base);
      if (!full.startsWith(MODELS_DIR) || !fs.existsSync(full)) {
        return send(res, 404, { error: 'model not found' });
      }
      const status = llamaStatus();
      if (
        status.state === 'ready' &&
        (status.model === full || status.mmproj === full)
      ) {
        stopLlama();
      }
      fs.unlinkSync(full);
      const patch = {};
      if (cfg.model === 'models/' + base) patch.model = '';
      if (cfg.mmproj === 'models/' + base) patch.mmproj = '';
      const pairings = { ...(cfg.modelProjectors || {}) };
      delete pairings[base];
      for (const [model, projector] of Object.entries(pairings)) {
        if (path.basename(projector) === base) delete pairings[model];
      }
      patch.modelProjectors = pairings;
      if ((cfg.starredModels || []).includes(base)) {
        patch.starredModels = cfg.starredModels.filter(n => n !== base);
      }
      if (Object.keys(patch).length) cfg = save({ ...cfg, ...patch });
      return send(res, 200, { ok: true });
    }

    // ---- Hugging Face ----
    if (pathname === '/api/hf/search' && req.method === 'GET') {
      const q = parsed.query;
      try {
        const results = await searchModels({
          query: q.query || 'gguf',
          limit: parseInt(q.limit) || 20,
          author: q.author,
        });
        return send(res, 200, { results });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    if (pathname === '/api/hf/files' && req.method === 'GET') {
      const { repo } = parsed.query;
      if (!repo) return send(res, 400, { error: 'repo required' });
      try {
        const files = await listGgufFiles(repo);
        return send(res, 200, { repo, files });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    if (pathname === '/api/hf/download' && req.method === 'POST') {
      const body = await readJson(req);
      const { repo, filename, sync, withProjector } = body;
      if (!repo || !filename) return send(res, 400, { error: 'repo and filename required' });

      // Pair vision models with the matching mmproj from the same repo.
      const startProjector = async () => {
        if (withProjector === false || isProjectorFile(filename)) return null;
        try {
          const match = await findProjector(repo, filename);
          if (!match) return null;
          // Remember the pairing so this projector is only used with this
          // model, never with unrelated text models.
          cfg = save({
            ...cfg,
            mmproj: '',
            modelProjectors: {
              ...(cfg.modelProjectors || {}),
              [filename]: 'models/' + match.filename,
            },
          });
          if (fs.existsSync(path.join(MODELS_DIR, match.filename))) {
            return { ...match, job: null };
          }
          return { ...match, job: startDownload(repo, match.filename) };
        } catch (e) {
          // A missing projector must not block the model download.
          return null;
        }
      };

      if (sync) {
        try {
          const result = await downloadGguf(repo, filename);
          const projector = await startProjector();
          cfg = save({ ...cfg, model: 'models/' + filename, activeEndpoint: 'local' });
          return send(res, 200, {
            ok: true,
            path: result.path,
            size: result.size,
            projector,
          });
        } catch (e) {
          return send(res, 500, { error: e.message });
        }
      }
      const job = startDownload(repo, filename);
      const projector = await startProjector();
      return send(res, 200, { ok: true, job, projector });
    }

    if (pathname === '/api/hf/projector' && req.method === 'GET') {
      const { repo, filename } = parsed.query;
      if (!repo || !filename) {
        return send(res, 400, { error: 'repo and filename required' });
      }
      try {
        const projector = await findProjector(repo, filename);
        return send(res, 200, { repo, model: filename, projector });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    if (pathname === '/api/hf/projector' && req.method === 'POST') {
      const body = await readJson(req);
      const requested = body.model || body.filename;
      if (!requested) return send(res, 400, { error: 'model required' });
      const model = path.basename(String(requested));
      if (isProjectorFile(model)) {
        return send(res, 400, {
          error: 'That file is already a vision projector.',
        });
      }
      const repo = body.repo || findRepoForModel(model);
      if (!repo) {
        return send(res, 404, {
          error:
            'No Hugging Face repository is recorded for ' +
            model +
            '. Download it from Discover to enable vision.',
        });
      }
      try {
        const projector = await findProjector(repo, model);
        if (!projector) {
          return send(res, 404, {
            error: 'No vision projector (mmproj) was found in ' + repo + '.',
          });
        }
        // Bundle the projector with this exact model.
        cfg = save({
          ...cfg,
          mmproj: '',
          modelProjectors: {
            ...(cfg.modelProjectors || {}),
            [model]: 'models/' + projector.filename,
          },
        });
        if (fs.existsSync(path.join(MODELS_DIR, projector.filename))) {
          return send(res, 200, {
            ok: true,
            repo,
            model,
            projector: { ...projector, job: null },
          });
        }
        const job = startDownload(repo, projector.filename);
        return send(res, 200, {
          ok: true,
          repo,
          model,
          projector: { ...projector, job },
        });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    if (pathname === '/api/hf/jobs' && req.method === 'GET') {
      return send(res, 200, { jobs: listJobs() });
    }

    const jobMatch = pathname.match(
      /^\/api\/hf\/jobs\/([^/]+)(\/cancel|\/resume|\/remove)?$/,
    );
    if (jobMatch) {
      const id = jobMatch[1];
      const action = jobMatch[2];
      if (action && req.method === 'POST') {
        if (action === '/cancel') return send(res, 200, { ok: cancelJob(id) });
        if (action === '/resume') {
          const job = resumeJob(id);
          if (!job) return send(res, 404, { error: 'job not found' });
          return send(res, 200, { ok: true, job });
        }
        if (action === '/remove') return send(res, 200, { ok: removeJob(id) });
      }
      if (req.method === 'GET') {
        const job = getJob(id);
        if (!job) return send(res, 404, { error: 'job not found' });
        return send(res, 200, { job });
      }
    }

    // ---- Tools ----
    if (pathname === '/api/tools' && req.method === 'GET') {
      const tools = TOOL_SCHEMA.map(t => ({
        ...t.function,
        enabled: (cfg.toolsEnabled || {})[t.function.name] !== false,
      }));
      return send(res, 200, { tools });
    }

    if (pathname === '/api/tools' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.toolsEnabled && typeof body.toolsEnabled === 'object') {
        cfg = save({ ...cfg, toolsEnabled: { ...cfg.toolsEnabled, ...body.toolsEnabled } });
      } else if (body.name) {
        cfg = save({
          ...cfg,
          toolsEnabled: { ...cfg.toolsEnabled, [body.name]: !!body.enabled },
        });
      }
      return send(res, 200, { ok: true, toolsEnabled: cfg.toolsEnabled });
    }

    if (pathname === '/api/tools/test' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body.name) return send(res, 400, { error: 'name required' });
      try {
        const result = await executeTool(body.name, body.args || {});
        return send(res, 200, { ok: true, result });
      } catch (e) {
        return send(res, 500, { ok: false, error: e.message });
      }
    }

    // ---- OpenAI-compatible chat ----
    if (pathname === '/v1/chat/completions' && req.method === 'POST') {
      const body = await readJson(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const opts = {
        temperature: body.temperature,
        topP: body.top_p,
        maxTokens: body.max_tokens,
        thinkingEffort: body.thinking_effort || body.reasoning_effort,
      };
      if (cfg.systemPrompt && !messages.some(m => m.role === 'system')) {
        messages.unshift({ role: 'system', content: cfg.systemPrompt });
      }

      const persist = (content, reasoning, model, stats) => {
        if (!body.chatId) return;
        try {
          const existing = readChat(body.chatId);
          if (!existing) return;
          const responseModel = model || cfg.model || 'external';
          existing.messages = existing.messages || [];
          const lastUser = [...messages].reverse().find(m => m.role === 'user');
          existing.messages.push({
            role: 'user',
            content: lastUser ? contentToText(lastUser.content) : '',
          });
          existing.messages.push({
            role: 'assistant',
            content,
            reasoning: reasoning || undefined,
            model: responseModel,
            stats: stats || undefined,
            createdAt: Date.now(),
          });
          existing.model = responseModel;
          writeChat(existing);
        } catch (e) {
          // non-fatal
        }
      };

      if (body.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
        });
        const writeEvent = obj => {
          try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) { /* client gone */ }
        };
        let finalContent = '';
        let finalReasoning = '';
        try {
          const result = await streamChatCompletion(messages, opts, evt => {
            if (evt.type === 'delta') {
              finalContent += evt.content;
              writeEvent({
                id: 'chatcmpl-local',
                object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: { content: evt.content } }],
              });
            } else if (evt.type === 'reasoning') {
              finalReasoning += evt.content;
              writeEvent({ type: 'reasoning', content: evt.content });
            } else if (evt.type === 'tool') {
              writeEvent({ type: 'tool', name: evt.name, args: evt.args });
            } else if (evt.type === 'tool_result') {
              writeEvent({ type: 'tool_result', name: evt.name, result: evt.result });
            }
          });
          if (!finalContent && result.content) {
            finalContent = result.content;
            writeEvent({
              id: 'chatcmpl-local',
              object: 'chat.completion.chunk',
              choices: [{ index: 0, delta: { content: result.content } }],
            });
          }
          persist(finalContent, finalReasoning, result.model, result.stats);
          if (result.stats) {
            writeEvent({ type: 'usage', ...result.stats });
          }
          writeEvent({
            id: 'chatcmpl-local',
            object: 'chat.completion.chunk',
            model: result.model || cfg.model || 'local',
            usage: result.usage || undefined,
            timings: result.timings || undefined,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          });
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (e) {
          writeEvent({ error: e.message });
          res.write('data: [DONE]\n\n');
          res.end();
        }
        return;
      }

      try {
        const result = await chatCompletion(messages, opts);
        persist(result.content, result.reasoning, result.model);
        return send(res, 200, {
          id: 'chatcmpl-local',
          object: 'chat.completion',
          model: result.model || cfg.model || 'local',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: result.content,
              reasoning_content: result.reasoning || undefined,
            },
            finish_reason: 'stop',
          }],
          usage: result.usage || {},
        });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    if (pathname === '/api/stop' && req.method === 'POST') {
      stopLlama();
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/shutdown' && req.method === 'POST') {
      send(res, 200, { ok: true });
      setTimeout(() => {
        stopLlama();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 800);
      }, 50);
      return;
    }

    return send(res, 404, { error: 'route not found' });
  } catch (err) {
    console.error('[api]', err);
    if (!res.headersSent) return send(res, 500, { error: err.message || String(err) });
    try { res.end(); } catch (e) { /* ignore */ }
  }
}

const server = http.createServer(handle);

server.listen(PORT, HOST, () => {
  console.log('LibreHarnes listening on http://' + HOST + ':' + PORT);
  console.log('  Web UI:   http://' + HOST + ':' + PORT + '/');
  console.log('  API:      http://' + HOST + ':' + PORT + '/v1/chat/completions');
  console.log('  Config:   http://' + HOST + ':' + PORT + '/api/config');
  console.log('  Models:   ' + MODELS_DIR);
  console.log('  Chats:    ' + path.join(ROOT, 'chats'));
});

process.on('SIGINT', () => {
  stopLlama();
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  stopLlama();
  server.close(() => process.exit(0));
});
