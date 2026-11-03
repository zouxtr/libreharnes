#!/usr/bin/env node
'use strict';

/**
 * Download a prebuilt CPU-only llama.cpp release for the current platform and
 * place llama-server (plus its shared libraries) in llama.cpp/build/bin/.
 *
 * Usage:
 *   node scripts/setup-llama.js           # install if missing
 *   node scripts/setup-llama.js --force   # reinstall
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
const FORCE = process.argv.includes('--force');
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

function assetPattern(tag) {
  const arch = process.arch;
  if (process.platform === 'linux') {
    if (arch === 'arm64') return `llama-${tag}-bin-ubuntu-arm64.tar.gz`;
    return `llama-${tag}-bin-ubuntu-x64.tar.gz`;
  }
  if (process.platform === 'darwin') {
    if (arch === 'arm64') return `llama-${tag}-bin-macos-arm64.tar.gz`;
    return `llama-${tag}-bin-macos-x64.tar.gz`;
  }
  if (process.platform === 'win32') {
    if (arch === 'arm64') return `llama-${tag}-bin-win-cpu-arm64.zip`;
    return `llama-${tag}-bin-win-cpu-x64.zip`;
  }
  return null;
}

async function findRelease() {
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
    const wanted = assetPattern(tag);
    if (!wanted) continue;
    const asset = (release.assets || []).find((a) => a.name === wanted);
    if (asset) return { tag, asset };
  }
  throw new Error(
    `No prebuilt llama.cpp asset found for ${process.platform}/${process.arch}. ` +
      'You can build from source with scripts/build-llama.sh instead.',
  );
}

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

async function main() {
  if (fs.existsSync(SERVER_PATH) && !FORCE) {
    log('llama.cpp is already installed at ' + SERVER_PATH);
    log('Use --force to reinstall.');
    return;
  }

  if (!assetPattern('TAG')) {
    throw new Error('Unsupported platform: ' + process.platform + '/' + process.arch);
  }

  const { tag, asset } = await findRelease();
  log(`Selected llama.cpp ${tag} (${asset.name})`);

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
    log('Installed llama-server at ' + SERVER_PATH);
    const check = spawnSync(SERVER_PATH, ['--version'], {
      timeout: 15000,
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
