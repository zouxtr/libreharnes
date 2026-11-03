#!/usr/bin/env node
'use strict';

/**
 * LibreHarnes launcher.
 *
 * Starts the local server if it is not already running, then opens a small
 * native launcher window (GTK on Linux, WinForms on Windows) with the app
 * address. Falls back to the browser-based launcher at /launcher.
 *
 * Usage:
 *   node scripts/launch.js             # start + open launcher window
 *   node scripts/launch.js --browser   # open the launcher page in a browser
 *   node scripts/launch.js --server    # only run the server (no window)
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const FORCE_BROWSER = args.has('--browser');
const SERVER_ONLY = args.has('--server');

let port = 3030;
let host = '127.0.0.1';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  if (cfg.port) port = cfg.port;
  if (cfg.host) host = cfg.host;
} catch {
  /* defaults */
}
const connectHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
const URL_BASE = `http://${connectHost}:${port}`;
const APP_URL = URL_BASE + '/';

let serverChild = null;
let launcherChild = null;
let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serverResponding(timeout = 700) {
  return new Promise((resolve) => {
    const req = http.get(URL_BASE + '/api/config', { timeout }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

async function waitForServer(maxMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await serverResponding()) return true;
    if (serverChild && serverChild.exitCode !== null) return false;
    await sleep(300);
  }
  return false;
}

function openBrowser(url) {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

function hasGtk() {
  if (process.platform !== 'linux') return false;
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  const script = path.join(__dirname, 'launcher_gtk.py');
  if (!fs.existsSync(script)) return false;
  const probe = spawnSync(
    'python3',
    ['-c', 'import gi; gi.require_version("Gtk", "4.0")'],
    { stdio: 'ignore' },
  );
  return probe.status === 0;
}

function runAndWait(command, commandArgs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, commandArgs, { cwd: ROOT, stdio: 'inherit' });
    } catch {
      resolve(-1);
      return;
    }
    launcherChild = child;
    child.on('error', () => {
      launcherChild = null;
      resolve(-1);
    });
    child.on('exit', (code) => {
      launcherChild = null;
      resolve(code == null ? -1 : code);
    });
  });
}

async function stopServer() {
  if (!serverChild || serverChild.exitCode !== null) return;
  const child = serverChild;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once('exit', finish);
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
    }
    setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
      finish();
    }, 2500).unref();
  });
}

function installSignalHandlers() {
  const onSignal = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      if (launcherChild) launcherChild.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    stopServer().finally(() => process.exit(0));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}

async function main() {
  installSignalHandlers();

  const alreadyRunning = await serverResponding();
  if (!alreadyRunning) {
    console.log('Starting LibreHarnes server…');
    serverChild = spawn(process.execPath, [path.join(ROOT, 'harness', 'src', 'index.js')], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    serverChild.on('exit', (code) => {
      serverChild = null;
      if (!shuttingDown) {
        process.exit(code == null ? 0 : code);
      }
    });
    const ok = await waitForServer();
    if (!ok) {
      console.error(
        '\nLibreHarnes did not start. Run it directly for details:\n  node harness/src/index.js\n',
      );
      await stopServer();
      process.exit(1);
    }
  } else {
    console.log('LibreHarnes is already running at ' + APP_URL);
  }

  console.log('LibreHarnes is ready at ' + APP_URL);

  if (SERVER_ONLY) {
    // Keep the process alive while the server runs.
    await new Promise(() => {});
    return;
  }

  let usedNative = false;
  if (!FORCE_BROWSER) {
    if (process.platform === 'win32') {
      const ps = path.join(__dirname, 'launcher.ps1');
      if (fs.existsSync(ps)) {
        const code = await runAndWait('powershell.exe', [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          ps,
          '-Url',
          APP_URL,
        ]);
        usedNative = code === 0;
      }
    } else if (hasGtk()) {
      const code = await runAndWait('python3', [
        path.join(__dirname, 'launcher_gtk.py'),
        APP_URL,
      ]);
      usedNative = code === 0;
    }
  }

  if (usedNative) {
    // The launcher window was closed (or Stop was pressed).
    await stopServer();
    process.exit(0);
  }

  // Browser fallback: open the small launcher page and keep the server alive.
  if (!openBrowser(URL_BASE + '/launcher')) {
    console.log('Open this address in your browser: ' + URL_BASE + '/launcher');
  }
  console.log('Press Ctrl+C to stop LibreHarnes.');
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Launcher error:', err && err.message ? err.message : err);
  stopServer().finally(() => process.exit(1));
});
