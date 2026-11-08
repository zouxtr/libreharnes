# LibreHarnes installer for Windows.
#
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/zouxtr/libreharnes/main/install.ps1 | iex"
#
# Environment:
#   LIBREHARNES_DIR   install directory (default: %LOCALAPPDATA%\LibreHarnes)
#   LIBREHARNES_SKIP_LLAMA=1   do not download llama.cpp
#   LIBREHARNES_LLAMA_BACKEND=cpu|gpu|auto|vulkan|metal
#                              choose the llama.cpp build without prompting

$ErrorActionPreference = "Stop"

$Repo = "zouxtr/libreharnes"
$Branch = "main"
if ($env:LIBREHARNES_DIR) {
  $InstallDir = $env:LIBREHARNES_DIR
} else {
  $InstallDir = Join-Path $env:LOCALAPPDATA "LibreHarnes"
}

function Write-Step($Message) { Write-Host $Message }
function Fail($Message) { Write-Error $Message; exit 1 }

function Read-Choice($Prompt, $Default) {
  if (-not [Environment]::UserInteractive) { return "" }
  try {
    $answer = Read-Host $Prompt
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return $answer.Trim()
  } catch {
    return ""
  }
}

Write-Host ""
Write-Host "LibreHarnes installer"
Write-Host "---------------------"

$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
  Fail "Node.js 18 or newer is required. Install it from https://nodejs.org and run this again."
}
$NodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($NodeMajor -lt 18) {
  Fail "Node.js 18 or newer is required (found $(& node --version))."
}
Write-Step "Node.js $(& node --version)"

$TempDir = Join-Path $env:TEMP ("libreharnes-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
try {
  Write-Step "Downloading LibreHarnes…"
  $Zip = Join-Path $TempDir "libreharnes.zip"
  Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $Zip -UseBasicParsing -Headers @{ "Cache-Control" = "no-cache" }

  Write-Step "Extracting…"
  $ExtractDir = Join-Path $TempDir "src"
  Expand-Archive -LiteralPath $Zip -DestinationPath $ExtractDir -Force
  $SourceDir = Get-ChildItem -Path $ExtractDir -Directory | Select-Object -First 1
  if (-not $SourceDir) { Fail "The downloaded archive was empty." }

  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  if (Test-Path (Join-Path $InstallDir "config.json")) {
    Write-Step "Updating existing install (models, chats and settings are preserved)…"
  } else {
    Write-Step "Installing app files…"
  }

  # Copy application files only. Never overwrite or remove runtime data from
  # an earlier install, so re-running the installer is a safe update.
  $ExcludedDirs = @("models", "chats", "sandbox", "llama.cpp", "node_modules", ".git")
  $ExcludedFiles = @("config.json", "downloads.json")
  Get-ChildItem -LiteralPath $SourceDir.FullName -Force | ForEach-Object {
    if ($_.PSIsContainer -and $ExcludedDirs -contains $_.Name) { return }
    if (-not $_.PSIsContainer -and $ExcludedFiles -contains $_.Name) { return }
    Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force
  }
  Write-Step "Installed app files to $InstallDir"

  $LlamaBackend = ""
  if ($env:LIBREHARNES_SKIP_LLAMA -eq "1") {
    Write-Step "Skipping llama.cpp download (LIBREHARNES_SKIP_LLAMA=1)."
  } elseif ($env:LIBREHARNES_LLAMA_BACKEND) {
    $LlamaBackend = $env:LIBREHARNES_LLAMA_BACKEND.ToLower()
    if ($LlamaBackend -notin @("auto", "cpu", "gpu", "vulkan", "metal")) {
      Fail "LIBREHARNES_LLAMA_BACKEND must be auto, cpu, gpu, vulkan, or metal."
    }
  } else {
    $installAnswer = Read-Choice "Install the llama.cpp runtime now? [Y/n]" "y"
    if ($installAnswer -eq "") {
      Write-Step ""
      Write-Step "No terminal available to ask about llama.cpp, so it was skipped."
      Write-Step "Re-run interactively, or set LIBREHARNES_LLAMA_BACKEND=cpu|gpu."
    } elseif ($installAnswer -match '^(n|no)$') {
      Write-Step "Skipping llama.cpp. You can install it later with:"
      Write-Step "  cd `"$InstallDir`" ; node scripts/setup-llama.js"
    } else {
      $choice = Read-Choice "Which build? 1) CPU only  2) GPU optimised (Vulkan) [2]" "2"
      if ($choice -match '^(1|cpu)') {
        $LlamaBackend = "cpu"
      } else {
        $LlamaBackend = "gpu"
      }
    }
  }

  if ($LlamaBackend) {
    Write-Step ""
    if ($LlamaBackend -eq "cpu") {
      Write-Step "Installing llama.cpp (CPU only)…"
    } elseif ($LlamaBackend -eq "gpu") {
      Write-Step "Installing llama.cpp (GPU optimised)…"
    } else {
      Write-Step "Installing llama.cpp ($LlamaBackend)…"
    }
    Push-Location $InstallDir
    try {
      $setupArgs = @()
      if ($LlamaBackend -ne "auto") { $setupArgs += "--$LlamaBackend" }
      & node scripts/setup-llama.js @setupArgs
      if ($LASTEXITCODE -ne 0) { Fail "llama.cpp setup failed." }
    } finally {
      Pop-Location
    }
  }

  $CmdLauncher = Join-Path $InstallDir "libreharnes.cmd"
  @"
@echo off
node "$InstallDir\scripts\launch.js" %*
"@ | Set-Content -Path $CmdLauncher -Encoding ASCII

  # Start Menu shortcut.
  try {
    $StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    New-Item -ItemType Directory -Path $StartMenu -Force | Out-Null
    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut((Join-Path $StartMenu "LibreHarnes.lnk"))
    $Shortcut.TargetPath = $CmdLauncher
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "Local AI on your hardware"
    $Shortcut.WindowStyle = 7
    $Shortcut.Save()
    Write-Step "Added Start Menu shortcut: LibreHarnes"
  } catch {
    Write-Step "Could not create a Start Menu shortcut (the app still works)."
  }

  Write-Host ""
  Write-Host "Done. Start LibreHarnes with:"
  Write-Host ""
  Write-Host "  $CmdLauncher"
  Write-Host ""
  Write-Host "The launcher window shows the app address. Models are downloaded"
  Write-Host "from the Models page inside the app."
  Write-Host ""
} finally {
  Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
