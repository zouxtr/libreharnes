#!/usr/bin/env node
'use strict';

/**
 * Download a prebuilt llama.cpp release for the current platform and place
 * llama-server (plus its shared libraries) in llama.cpp/build/bin/.
 *
 * By default the best available backend is auto-detected:
 *   - Windows/Linux with a GPU  -> Vulkan (works on AMD RDNA, NVIDIA, Intel Arc)
 *   - macOS                     -> Metal (built into the CPU release)
 *   - no usable GPU             -> CPU
 *
 * Usage:
 *   node scripts/setup-llama.js              # install (auto-detect backend)
 *   node scripts/setup-llama.js --gpu        # force Vulkan
 *   node scripts/setup-llama.js --cpu        # force CPU-only
 *   node scripts/setup-llama.js --force      # reinstall
 *   node scripts/setup-llama.js --dry-run    # print the selected asset only
 *
 * Environment:
 *   LIBREHARNES_LLAMA_BACKEND=auto|vulkan|cpu|metal
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ROOT = path.resolve(__dirname, '..');
const DEST_DIR = path.join(ROOT, 'llama.cpp', 'build', 'bin');
const SERVER_NAME = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const SERVER_PATH = path.join(DEST_DIR, SERVER_NAME);
const MARKER_PATH = path.join(DEST_DIR, '.backend');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const RELEASES_API =
  'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20';

function log(msg) {
  process.stdout.write(msg + '\n');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

// ---------------------------------------------------------------------------
// Backend detection
// ---------------------------------------------------------------------------

function requestedBackend() {
  const inline = process.argv.find((a) => a.startsWith('--backend='));
  if (inline) return inline.split('=')[1];
  if (process.argv.includes('--cpu')) return 'cpu';
  if (process.argv.includes('--vulkan') || process.argv.includes('--gpu')) {
    return 'vulkan';
  }
  if (process.argv.includes('--metal')) return 'metal';
  return process.env.LIBREHARNES_LLAMA_BACKEND || 'auto';
}

function gpuNames() {
  if (process.platform === 'win32') {
    try {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name',
        ],
        { encoding: 'utf8', timeout: 10000, windowsHide: true },
      );
      return (result.stdout || '').trim();
    } catch {
      return '';
    }
  }
  if (process.platform === 'linux') {
    try {
      const result = spawnSync(
        'sh',
        ['-c', 'lspci 2>/dev/null | grep -Ei "vga|3d|display"'],
        { encoding: 'utf8', timeout: 8000 },
      );
      return (result.stdout || '').trim();
    } catch {
      return '';
    }
  }
  return '';
}

function detectBackend() {
  if (process.platform === 'darwin') return 'metal';
  if (process.platform === 'linux') {
    // Presence of a DRM render node is a good proxy for a usable GPU.
    if (fs.existsSync('/dev/dri/renderD128') || fs.existsSync('/dev/dri/card0')) {
      return 'vulkan';
    }
  }
  const names = gpuNames().toLowerCase();
  if (!names) return 'cpu';
  // Ignore the Microsoft Basic Display Adapter and software renderers.
  const usable = names
    .split(/\r?\n/)
    .filter((n) => n && !/basic display|remote display|virtual|parsec/i.test(n));
  if (usable.length === 0) return 'cpu';
  if (/(amd|radeon|rx\s?\d|nvidia|geforce|rtx|gtx|quadro|intel.*arc|\barc\b)/i.test(names)) {
    return 'vulkan';
  }
  return 'cpu';
}

function resolveBackend() {
  const requested = requestedBackend();
  if (requested && requested !== 'auto') return requested;
  return detectBackend();
}

function assetPattern(tag, backend) {
  const arch = process.arch;
  if (process.platform === 'linux') {
    if (backend === 'vulkan') {
      if (arch === 'arm64') return `llama-${tag}-bin-ubuntu-vulkan-arm64.tar.gz`;
      return `llama-${tag}-bin-ubuntu-vulkan-x64.tar.gz`;
    }
    if (arch === 'arm64') return `llama-${tag}-bin-ubuntu-arm64.tar.gz`;
    return `llama-${tag}-bin-ubuntu-x64.tar.gz`;
  }
  if (process.platform === 'darwin') {
    // The macOS release ships Metal support.
    if (arch === 'arm64') return `llama-${tag}-bin-macos-arm64.tar.gz`;
    return `llama-${tag}-bin-macos-x64.tar.gz`;
  }
  if (process.platform === 'win32') {
    if (backend === 'vulkan') {
      if (arch === 'arm64') return `llama-${tag}-bin-win-vulkan-arm64.zip`;
      return `llama-${tag}-bin-win-vulkan-x64.zip`;
    }
    if (arch === 'arm64') return `llama-${tag}-bin-win-cpu-arm64.zip`;
    return `llama-${tag}-bin-win-cpu-x64.zip`;
  }
  return null;
}

async function findRelease(backend) {
  log('Looking up the latest llama.cpp release…');
  const res = await fetch(RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'libreharnes-installer',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub releases request failed (HTTP ${res.status})`);
  }
  const releases = await res.json();
  for (const release of releases) {
    const tag = release.tag_name || '';
    if (!tag || tag.startsWith('v')) continue;
    const wanted = assetPattern(tag, backend);
    if (!wanted) continue;
    const asset = (release.assets || []).find((a) => a.name === wanted);
    if (asset) return { tag, asset };
  }
  throw new Error(
    `No prebuilt llama.cpp asset found for ${process.platform}/${process.arch} (${backend}). ` +
      'You can build from source with scripts/build-llama.sh instead.',
  );
}

// ---------------------------------------------------------------------------
// Download / extract
// ---------------------------------------------------------------------------

async function download(url, dest) {
  log('Downloading ' + url);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'libreharnes-installer' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length') || 0);
  let received = 0;
  let lastPrint = 0;

  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastPrint > 200) {
      lastPrint = now;
      const pct = total ? Math.floor((received / total) * 100) : 0;
      process.stdout.write(
        `\r  ${formatBytes(received)}${total ? ' / ' + formatBytes(total) : ''}${
          total ? ' · ' + pct + '%' : ''
        }   `,
      );
    }
  });
  await pipeline(body, fs.createWriteStream(dest));
  process.stdout.write('\n');
}

function extract(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (archive.endsWith('.zip')) {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) throw new Error('Could not extract the archive.');
  } else {
    const result = spawnSync('tar', ['-xzf', archive, '-C', dest], {
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('Could not extract the archive.');
  }
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
      try {
        fs.chmodSync(to, fs.statSync(from).mode);
      } catch {
        /* ignore */
      }
    }
  }
}

function findArchiveRoot(dir) {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory());
  if (entries.length === 1) {
    const only = path.join(dir, entries[0].name);
    if (fs.existsSync(path.join(only, SERVER_NAME))) return only;
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Install bookkeeping
// ---------------------------------------------------------------------------

function installedBackend() {
  try {
    return fs.readFileSync(MARKER_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

function writeMarker(backend) {
  try {
    fs.mkdirSync(DEST_DIR, { recursive: true });
    fs.writeFileSync(MARKER_PATH, backend + '\n', 'utf8');
  } catch {
    /* non-fatal */
  }
}

/** Seed config.json with hardware-friendly defaults without clobbering users. */
function updateConfig(backend) {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    cfg = {};
  }
  cfg.llamaBackend = backend;
  if (cfg.gpuLayers === undefined) cfg.gpuLayers = backend === 'cpu' ? 0 : 99;
  if (cfg.flashAttention === undefined) cfg.flashAttention = true;
  // Vision models need a larger context; keep threads at physical cores.
  if (cfg.contextSize === undefined) cfg.contextSize = 8192;
  if (cfg.maxTokens === undefined) cfg.maxTokens = 2048;
  if (cfg.threads === undefined) {
    const logical = (os.cpus() || []).length || 4;
    cfg.threads =
      logical > 4 && logical % 2 === 0 ? Math.max(2, logical / 2) : logical;
  }
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {
    /* non-fatal */
  }
}

function describeGpu() {
  const names = gpuNames();
  return names ? names.split(/\r?\n/).join(', ') : '(no GPU detected)';
}

// ---------------------------------------------------------------------------

async function main() {
  const backend = resolveBackend();
  log(`Detected hardware: ${describeGpu()}`);
  log(`llama.cpp backend: ${backend}`);

  if (!assetPattern('TAG', backend)) {
    throw new Error('Unsupported platform: ' + process.platform + '/' + process.arch);
  }

  const current = installedBackend();
  const needsUpgrade =
    backend === 'vulkan' && fs.existsSync(SERVER_PATH) && current !== 'vulkan';

  if (fs.existsSync(SERVER_PATH) && !FORCE && !needsUpgrade) {
    log('llama.cpp is already installed at ' + SERVER_PATH);
    if (current !== backend) writeMarker(backend);
    updateConfig(backend);
    log('Use --force to reinstall.');
    return;
  }

  if (needsUpgrade) {
    log(
      `Existing install is "${current || 'cpu/unknown'}"; upgrading to Vulkan for GPU acceleration…`,
    );
  }

  const { tag, asset } = await findRelease(backend);
  log(`Selected llama.cpp ${tag} (${asset.name})`);

  if (DRY_RUN) {
    log('Dry run: no files were downloaded or changed.');
    return;
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'libreharnes-llama-'));
  const archive = path.join(temp, asset.name);
  try {
    await download(asset.browser_download_url, archive);
    log('Extracting…');
    const extracted = path.join(temp, 'extracted');
    extract(archive, extracted);
    const source = findArchiveRoot(extracted);
    fs.mkdirSync(DEST_DIR, { recursive: true });
    copyRecursive(source, DEST_DIR);
    if (process.platform !== 'win32') {
      fs.chmodSync(SERVER_PATH, 0o755);
    }
    if (!fs.existsSync(SERVER_PATH)) {
      throw new Error('llama-server was not found in the downloaded archive.');
    }
    writeMarker(backend);
    updateConfig(backend);
    log('Installed llama-server at ' + SERVER_PATH);
    const check = spawnSync(SERVER_PATH, ['--version'], {
      timeout: 20000,
      encoding: 'utf8',
    });
    if (check.status === 0) {
      const line = (check.stdout || check.stderr || '').split('\n')[0].trim();
      if (line) log(line);
    } else {
      log('Note: could not run llama-server --version, but the binary was installed.');
    }
  } finally {
    try {
      fs.rmSync(temp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error('\nllama.cpp setup failed: ' + (err.message || err));
  process.exit(1);
});
