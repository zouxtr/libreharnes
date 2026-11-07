'use strict';

const fs = require('fs');
const path = require('path');
const { SANDBOX_DIR } = require('../config');

function inSandbox(requested) {
  const target = path.resolve(SANDBOX_DIR, requested);
  const sandbox = path.resolve(SANDBOX_DIR);
  // Prevent path traversal outside the sandbox directory.
  if (target === sandbox || target.startsWith(sandbox + path.sep)) return target;
  return null;
}

function list() {
  if (!fs.existsSync(SANDBOX_DIR)) return [];
  return fs.readdirSync(SANDBOX_DIR).map(f => {
    const full = path.join(SANDBOX_DIR, f);
    const stat = fs.statSync(full);
    return { name: f, isDirectory: stat.isDirectory(), size: stat.size };
  });
}

function read(requested) {
  const target = inSandbox(requested);
  if (!target) return { error: 'Path outside sandbox' };
  if (!fs.existsSync(target)) return { error: 'File not found' };
  const stat = fs.statSync(target);
  if (stat.isDirectory()) return { error: 'Is a directory' };
  return { content: fs.readFileSync(target, 'utf8') };
}

function create(requested, content) {
  const target = inSandbox(requested);
  if (!target) return { error: 'Path outside sandbox' };
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return { ok: true, path: target };
}

module.exports = { list, read, create, SANDBOX_DIR };
