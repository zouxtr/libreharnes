'use strict';

// Hugging Face integration: search GGUF models and download them.
// Uses the public Hugging Face API. No API key required for public models.

const fetch = globalThis.fetch;
const fs = require('fs');
const path = require('path');
const { ROOT, MODELS_DIR } = require('./config');

const HF_API = 'https://huggingface.co/api';
const DOWNLOADS_FILE = path.join(ROOT, 'downloads.json');

function hfUrl(repo, filename, revision = 'main') {
  return `https://huggingface.co/${repo}/resolve/${revision}/${encodeURIComponent(filename)}`;
}

// ---------------------------------------------------------------------------
// Search / file listing
// ---------------------------------------------------------------------------

async function searchModels({ query = 'gguf', limit = 20, author } = {}) {
  const params = new URLSearchParams({
    search: query,
    limit: String(limit),
    full: 'false',
  });
  if (author) params.set('author', author);

  const res = await fetch(`${HF_API}/models?${params}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('HF search failed: ' + res.status);
  const data = await res.json();

  const candidates = [];
  for (const m of data) {
    const id = m.id || '';
    const tags = m.tags || [];
    const likes = m.likes || 0;
    const downloads = m.downloads || 0;
    const score = likes + downloads / 1000;
    const looksGGUF =
      /gguf/i.test(id) ||
      tags.some(t => /gguf/i.test(t)) ||
      /gguf/i.test(m.description || '') ||
      /quantized/i.test(id);

    if (!looksGGUF) continue;

    candidates.push({
      id,
      author: m.author || '',
      likes,
      downloads,
      score,
      tags: tags.slice(0, 8),
      description: (m.description || '').slice(0, 200),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

async function listGgufFiles(repo) {
  const res = await fetch(`${HF_API}/models/${repo}?blobs=true`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('HF model info failed: ' + res.status);
  const data = await res.json();
  const siblings = data.siblings || [];
  return siblings
    .filter(s => /\.gguf$/i.test(s.rfilename))
    .map(s => ({
      filename: s.rfilename,
      size: s.size || (s.lfs && s.lfs.size) || 0,
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

// ---------------------------------------------------------------------------
// Download jobs (persisted to downloads.json so they survive restarts)
// ---------------------------------------------------------------------------

const jobs = new Map();
let persistTimer = null;

function serializeJob(job) {
  return {
    id: job.id,
    repo: job.repo,
    filename: job.filename,
    status: job.status,
    received: job.received,
    total: job.total,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

function persistNow() {
  try {
    const arr = [...jobs.values()].map(serializeJob);
    fs.writeFileSync(DOWNLOADS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) {
    // non-fatal
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 800);
}

function loadPersistedJobs() {
  if (!fs.existsSync(DOWNLOADS_FILE)) return;
  try {
    const arr = JSON.parse(fs.readFileSync(DOWNLOADS_FILE, 'utf8'));
    for (const raw of arr) {
      if (!raw || !raw.id || !raw.filename) continue;
      jobs.set(raw.id, {
        id: raw.id,
        repo: raw.repo || '',
        filename: raw.filename,
        status: raw.status === 'downloading' ? 'paused' : raw.status || 'paused',
        received: raw.received || 0,
        total: raw.total || 0,
        error: raw.error || null,
        startedAt: raw.startedAt || Date.now(),
        finishedAt: raw.finishedAt || null,
        cancelled: false,
        controller: new AbortController(),
      });
    }
  } catch (e) {
    // ignore corrupt file
  }
}

loadPersistedJobs();

function publicJob(job) {
  const pct =
    job.total > 0
      ? Math.min(100, Math.round((job.received / job.total) * 100))
      : 0;
  return {
    id: job.id,
    repo: job.repo,
    filename: job.filename,
    status: job.status,
    received: job.received,
    total: job.total,
    progress: job.status === 'done' ? 100 : pct,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    resumable: ['paused', 'error', 'cancelled'].includes(job.status),
  };
}

function getJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

function listJobs() {
  return [...jobs.values()]
    .map(publicJob)
    .sort((a, b) => b.startedAt - a.startedAt);
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === 'downloading') {
    job.cancelled = true;
    try {
      job.controller.abort();
    } catch (e) {
      // ignore
    }
    job.status = 'cancelled';
    job.finishedAt = Date.now();
    persistNow();
  }
  return true;
}

function resumeJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === 'downloading') return publicJob(job);
  if (job.status === 'done') {
    const dest = path.join(MODELS_DIR, job.filename);
    if (fs.existsSync(dest)) return publicJob(job);
  }
  job.status = 'downloading';
  job.error = null;
  job.cancelled = false;
  job.finishedAt = null;
  job.controller = new AbortController();
  runDownload(job);
  return publicJob(job);
}

function removeJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  cancelJob(id);
  const part = path.join(MODELS_DIR, job.filename) + '.part';
  try {
    if (fs.existsSync(part)) fs.unlinkSync(part);
  } catch (e) {
    // ignore
  }
  jobs.delete(id);
  persistNow();
  return true;
}

async function runDownload(job) {
  const dest = path.join(MODELS_DIR, job.filename);
  const part = dest + '.part';

  try {
    if (fs.existsSync(dest)) {
      const size = fs.statSync(dest).size;
      job.received = size;
      job.total = size;
      job.status = 'done';
      job.finishedAt = Date.now();
      persistNow();
      return;
    }

    let start = 0;
    if (fs.existsSync(part)) start = fs.statSync(part).size;

    const headers = {};
    if (start > 0) headers.Range = `bytes=${start}-`;

    const res = await fetch(hfUrl(job.repo, job.filename), {
      headers,
      signal: job.controller.signal,
    });

    if (!res.ok) throw new Error('HF download failed: HTTP ' + res.status);
    if (!res.body) throw new Error('HF download: no response body');

    const isPartial = res.status === 206;
    if (!isPartial && start > 0) start = 0;

    const chunkLength = Number(res.headers.get('content-length') || 0);
    const total = isPartial ? start + chunkLength : chunkLength;
    job.total = total;
    job.received = start;

    const file = fs.createWriteStream(part, {
      flags: start > 0 && isPartial ? 'a' : 'w',
    });
    const reader = res.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (job.cancelled) throw new Error('cancelled');
        const chunk = Buffer.from(value);
        job.received += chunk.length;
        await new Promise((resolve, reject) => {
          file.write(chunk, err => (err ? reject(err) : resolve()));
        });
        schedulePersist();
      }
    } finally {
      reader.releaseLock();
      await new Promise(resolve => file.end(resolve));
    }

    if (job.cancelled) throw new Error('cancelled');

    const finalSize = fs.statSync(part).size;
    if (job.total > 0 && finalSize !== job.total) {
      throw new Error(
        `Download incomplete (${finalSize} of ${job.total} bytes). Resume to continue.`,
      );
    }

    fs.renameSync(part, dest);
    job.received = finalSize;
    job.total = finalSize;
    job.status = 'done';
    job.finishedAt = Date.now();
    persistNow();
  } catch (err) {
    if (job.cancelled) {
      job.status = 'cancelled';
    } else {
      job.status = 'error';
      job.error = err.message || String(err);
    }
    job.finishedAt = Date.now();
    persistNow();
  }
}

function startDownload(repo, filename) {
  const existing = [...jobs.values()].find(
    j => j.repo === repo && j.filename === filename,
  );
  if (existing) {
    if (existing.status === 'downloading') return publicJob(existing);
    if (['paused', 'error', 'cancelled'].includes(existing.status)) {
      return resumeJob(existing.id) || publicJob(existing);
    }
    if (existing.status === 'done') {
      if (fs.existsSync(path.join(MODELS_DIR, filename))) {
        return publicJob(existing);
      }
      jobs.delete(existing.id);
    }
  }

  const id = 'dl_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const job = {
    id,
    repo,
    filename,
    status: 'downloading',
    received: 0,
    total: 0,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    cancelled: false,
    controller: new AbortController(),
  };
  jobs.set(id, job);
  persistNow();
  runDownload(job);
  return publicJob(job);
}

// Synchronous helper kept for compatibility.
async function downloadGguf(repo, filename, { onProgress } = {}) {
  const job = startDownload(repo, filename);
  while (true) {
    const j = jobs.get(job.id);
    if (!j || j.status !== 'downloading') break;
    if (onProgress) onProgress(j.received, j.total);
    await new Promise(r => setTimeout(r, 400));
  }
  const j = jobs.get(job.id);
  if (j && j.status === 'done') {
    return {
      ok: true,
      path: path.join(MODELS_DIR, filename),
      size: j.received,
      skipped: false,
    };
  }
  throw new Error((j && j.error) || 'Download failed');
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  searchModels,
  listGgufFiles,
  startDownload,
  downloadGguf,
  getJob,
  listJobs,
  cancelJob,
  resumeJob,
  removeJob,
  formatSize,
  hfUrl,
};
