# LibreHarnes installer for Windows.
#
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/zouxtr/libreharnes/main/install.ps1 | iex"
#
# Environment:
#   LIBREHARNES_DIR   install directory (default: %LOCALAPPDATA%\LibreHarnes)
#   LIBREHARNES_SKIP_LLAMA=1   do not download llama.cpp

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
  Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $Zip -UseBasicParsing

  Write-Step "Extracting…"
  $ExtractDir = Join-Path $TempDir "src"
  Expand-Archive -LiteralPath $Zip -DestinationPath $ExtractDir -Force
  $SourceDir = Get-ChildItem -Path $ExtractDir -Directory | Select-Object -First 1
  if (-not $SourceDir) { Fail "The downloaded archive was empty." }

  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $SourceDir.FullName "*") -Destination $InstallDir -Recurse -Force
  Write-Step "Installed app files to $InstallDir"

  if ($env:LIBREHARNES_SKIP_LLAMA -ne "1") {
    Write-Step ""
    Write-Step "Installing llama.cpp (CPU build)…"
    Push-Location $InstallDir
    try {
      & node scripts/setup-llama.js
      if ($LASTEXITCODE -ne 0) { Fail "llama.cpp setup failed." }
    } finally {
      Pop-Location
    }
  } else {
    Write-Step "Skipping llama.cpp download (LIBREHARNES_SKIP_LLAMA=1)."
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
    $Shortcut.Description = "Local AI on your CPU"
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
