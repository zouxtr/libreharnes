# LibreHarnes

A lightweight, CPU-first AI harness for running local GGUF models — with a
small native launcher, a clean web app, and an OpenAI-compatible API.

No Electron. No bundled models. No GPU required. The app is a zero-dependency
Node.js server plus [llama.cpp](https://github.com/ggml-org/llama.cpp) and a
small React frontend.

![LibreHarnes](https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-2f2f2f)
![Node](https://img.shields.io/badge/node-%3E%3D18-2f2f2f)
![License](https://img.shields.io/badge/license-MIT-2f2f2f)

## Install

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/zouxtr/libreharnes/main/install.sh | bash
```

Then start it:

```bash
libreharnes
```

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/zouxtr/libreharnes/main/install.ps1 | iex"
```

The installer puts the app in `%LOCALAPPDATA%\LibreHarnes` and adds a Start Menu
shortcut. Start it from there, or run `libreharnes.cmd` in the install folder.

### What the installer does

1. Downloads the app source from GitHub.
2. Downloads the matching **prebuilt CPU-only** llama.cpp release into
   `llama.cpp/build/bin/`.
3. Creates a `libreharnes` command (and a desktop entry on Linux).

It does **not** download any models. You choose those inside the app.

Re-running the same `curl` command updates the application. Models, chats,
uploads, and settings are kept: the installer only copies app files and skips
`models/`, `chats/`, `sandbox/`, `llama.cpp/`, `config.json`, and
`downloads.json`.

### Manual install

```bash
git clone https://github.com/zouxtr/libreharnes.git
cd libreharnes
node scripts/setup-llama.js
node scripts/launch.js
```

Requirements: **Node.js 18+** and `curl` + `tar` (or PowerShell on Windows).
If a prebuilt llama.cpp is not available for your platform, build it with
`bash scripts/build-llama.sh` (needs a C++ toolchain and CMake).

## Using LibreHarnes

Starting the app opens a small launcher window with the address of the local
server (`http://127.0.0.1:3030` by default). From there you can:

- **Open LibreHarnes** in your browser.
- **Copy the link** for another browser or device.
- **Stop server & quit** to shut everything down.

The app itself has four pages:

### Chat
Streaming chat with local GGUF models. When a model emits reasoning, a
collapsible **Thinking** block appears above the answer; use the **Thinking**
toggle in the chat toolbar to keep thinking expanded by default. Tool calls
show their name, arguments, and result in an expandable block.

Use the paperclip button in the composer to attach files. Text files are sent
to the model inline; other files are saved under `sandbox/uploads/` and their
path is shared with the model. Switching pages does not interrupt an in-flight
response or clear the composer — the chat stays mounted in the background.
Every assistant message shows which model wrote it, plus generation speed
(tokens per second), token count, and generation time when the backend reports
them. You can switch models, choose thinking effort, regenerate, and clear the
conversation.

### Models
- **Local** — models on disk; star favorites, load, unload, delete. Starred
  models are pinned to the top of the list and appear first in the chat model
  picker; the **Starred** filter shows only them. Stars are stored in
  `config.json`, so they survive updates and reinstalls.
- **Discover** — search Hugging Face for GGUF repos, expand a repo, download a
  quant.
- **Downloads** — every download job with live progress. Interrupted transfers
  are paused and can be **resumed** from the byte they stopped at. Failed or
  cancelled jobs can be retried, and completed ones can be loaded directly.

### Tools
Enable or disable built-in tools and run them manually:

- Web search (DuckDuckGo Lite, no key required)
- HTML page reading
- Sandboxed file listing / reading / creation in `sandbox/`

### Settings
Theme (light / dark / system), system prompt, temperature, context size,
threads, local model path, and OpenAI-compatible endpoints with API keys.

## Configuration

Runtime settings live in `config.json` (created on first run, gitignored). You
can also copy `config.json.example` and edit it:

```json
{
  "port": 3030,
  "host": "127.0.0.1",
  "activeEndpoint": "local",
  "endpoints": [
    {
      "name": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "key": "sk-or-...",
      "model": "openai/gpt-4o-mini",
      "type": "external"
    }
  ]
}
```

- `activeEndpoint: "local"` uses llama.cpp and your downloaded GGUF.
- Any other name routes requests to that OpenAI-compatible endpoint.

### OpenAI-compatible API

The local server also exposes an OpenAI-compatible endpoint, so existing tools
can use LibreHarnes directly:

```bash
curl http://127.0.0.1:3030/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "local",
    "messages": [{ "role": "user", "content": "Hello" }]
  }'
```

## Project layout

```
LibreHarnes/
├── harness/                 # zero-dependency Node server
│   └── src/
│       ├── index.js         # HTTP routes, static UI, launcher
│       ├── proxy.js         # llama.cpp lifecycle + tool loop
│       ├── hf.js            # Hugging Face search/download jobs
│       ├── config.js        # config + chat persistence
│       └── tools/           # search, HTML, sandboxed files
├── frontend/                # React + TypeScript + Tailwind UI
│   └── dist/                # prebuilt UI (committed for curl installs)
├── web/launcher.html        # browser launcher page
├── scripts/
│   ├── launch.js            # start server + open launcher window
│   ├── launcher_gtk.py      # native GTK launcher (Linux)
│   ├── launcher.ps1         # native WinForms launcher (Windows)
│   ├── setup-llama.js       # download prebuilt llama.cpp
│   └── build-llama.sh       # build llama.cpp from source
├── install.sh
├── install.ps1
└── config.json.example
```

Runtime folders (`models/`, `chats/`, `sandbox/`, `llama.cpp/`, `config.json`,
`downloads.json`) are gitignored.

## Development

```bash
# Backend (serves the built UI at http://127.0.0.1:3030)
node harness/src/index.js

# Frontend dev server (proxies /api and /v1 to :3030)
cd frontend
npm install
npm run dev

# Production build
cd frontend && npm run build
```

## License

MIT
