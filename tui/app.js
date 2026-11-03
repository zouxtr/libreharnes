#!/usr/bin/env node
'use strict';

// LibreHarnes terminal UI.
// Thin terminal client that talks to the harness HTTP API.
// Zero external dependencies: readline + ANSI escape codes only.

const readline = require('readline');
const fetch = globalThis.fetch;

const BASE = 'http://127.0.0.1:3030';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  clear: '\x1b[2J',
  home: '\x1b[H',
  hide: '\x1b[?25l',
  show: '\x1b[?25h',
};

let messages = [];
let inputLine = '';
let cursorPos = 0;
let status = 'idle';
let modelName = '(none)';
let width = 80;
let height = 24;

process.stdout.write(C.clear + C.hide);
process.stdin.setRawMode(true);
process.stdin.resume();

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function wrap(text, width) {
  if (!text) return [''];
  const lines = [];
  const words = String(text).split(/\s+/);
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (t.length <= width) cur = t;
    else { lines.push(cur); cur = w; }
  }
  lines.push(cur);
  return lines;
}

function render() {
  let out = C.home;
  out += C.bold + C.cyan + 'LibreHarnes' + C.reset + '  terminal UI  |  ' + C.dim + 'CPU + llama.cpp' + C.reset + '\n';
  out += C.dim + 'model: ' + modelName + '   status: ' + status + '   (Ctrl+C to quit, Ctrl+L to clear)' + C.reset + '\n';
  out += '\n';

  const headerLines = 4;
  const footerLines = 3;
  const chatHeight = height - headerLines - footerLines - 1;
  const visible = messages.slice(-Math.max(1, chatHeight));
  let chatLinesRendered = 0;
  for (const m of visible) {
    const prefix = m.role === 'user' ? C.green + '> you' : C.magenta + '> llama';
    const color = m.role === 'user' ? C.green : C.reset;
    const lines = wrap(m.content || '', Math.max(20, width - 4));
    out += prefix + C.reset + ': ' + color + lines[0] + C.reset + '\n';
    chatLinesRendered++;
    for (let i = 1; i < lines.length; i++) { out += '     ' + color + lines[i] + C.reset + '\n'; chatLinesRendered++; }
    out += C.dim + '   ' + (m.role === 'user' ? '(you)' : '(assistant)') + C.reset + '\n'; chatLinesRendered++;
  }
  for (let i = chatLinesRendered; i < chatHeight; i++) out += '\n';

  out += '\n';
  out += C.bold + C.yellow + 'you: ' + C.reset + inputLine + '\n';
  out += C.dim + '(Enter to send | Ctrl+L clear | Ctrl+C quit)' + C.reset + '\n';

  process.stdout.write(out);
}

async function loadConfig() {
  try {
    const r = await fetch(BASE + '/api/config');
    const c = await r.json();
    modelName = c.model || '(none)';
    status = c.hasLocalModel ? 'model ready' : 'no model';
  } catch (e) {
    status = 'harness not reachable';
  }
}

async function sendMessage() {
  const text = inputLine.trim();
  if (!text) { render(); return; }
  messages.push({ role: 'user', content: text });
  inputLine = '';
  cursorPos = 0;
  status = 'thinking…';
  render();
  try {
    const r = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, messages: [{ role: 'user', content: text }] }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      messages.push({ role: 'assistant', content: '[error] ' + (err.error || 'HTTP ' + r.status) });
    } else {
      const data = await r.json();
      const content = data.choices && data.choices[0] ? data.choices[0].message.content : '';
      messages.push({ role: 'assistant', content: content || '(no response)' });
    }
  } catch (e) {
    messages.push({ role: 'assistant', content: '[error] ' + e.message });
  }
  status = 'idle';
  await loadConfig();
  render();
}

process.stdin.on('data', chunk => {
  const str = chunk.toString();
  if (str === '\x03') { process.stdout.write(C.show + C.reset + '\n'); process.exit(0); }
  if (str === '\x0c') { messages = []; render(); return; }
  if (str === '\r' || str === '\n') { sendMessage(); return; }
  if (str === '\x7f' || str === '\b') { if (cursorPos > 0) { inputLine = inputLine.slice(0, cursorPos - 1) + inputLine.slice(cursorPos); cursorPos--; } render(); return; }
  if (str === '\x15') { inputLine = ''; cursorPos = 0; render(); return; }
  if (str === '\x01') { cursorPos = 0; render(); return; }
  if (str === '\x05') { cursorPos = inputLine.length; render(); return; }
  if (str === '\x1b[D') { cursorPos = clamp(cursorPos - 1, 0, inputLine.length); render(); return; }
  if (str === '\x1b[C') { cursorPos = clamp(cursorPos + 1, 0, inputLine.length); render(); return; }
  if (str === '\x1b[A' || str === '\x1b[B') { render(); return; }
  if (str >= ' ' && str <= '~') { inputLine = inputLine.slice(0, cursorPos) + str + inputLine.slice(cursorPos); cursorPos++; render(); return; }
});

process.stdout.on('resize', () => { width = process.stdout.columns || 80; height = process.stdout.rows || 24; render(); });

async function main() {
  width = process.stdout.columns || 80;
  height = process.stdout.rows || 24;
  await loadConfig();
  render();
  setInterval(async () => { await loadConfig(); render(); }, 3000);
}

main().catch(e => { process.stdout.write(C.show); console.error(e.message); process.exit(1); });
