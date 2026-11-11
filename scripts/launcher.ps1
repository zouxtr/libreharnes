param(
  [string]$Url = "http://127.0.0.1:3030/"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not $Url.EndsWith("/")) { $Url += "/" }
$baseUrl = $Url.TrimEnd("/")

$script:lanSync = $false
$script:lanUrl = $null
$script:lanOn = $false
try {
  $cfg = Invoke-RestMethod -Uri "$baseUrl/api/config" -TimeoutSec 2
  if ($cfg.lanUrl) { $script:lanUrl = $cfg.lanUrl }
  $script:lanOn = ($cfg.host -eq "0.0.0.0")
} catch { }

function Get-DisplayUrl {
  if ($script:lanOn -and $script:lanUrl) { return $script:lanUrl }
  return $Url
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "LibreHarnes"
$form.ClientSize = New-Object System.Drawing.Size(420, 262)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(26, 26, 26)
$form.ForeColor = [System.Drawing.Color]::FromArgb(236, 236, 236)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$logo = New-Object System.Windows.Forms.Label
$logo.Text = "LH"
$logo.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$logo.TextAlign = "MiddleCenter"
$logo.Size = New-Object System.Drawing.Size(36, 36)
$logo.Location = New-Object System.Drawing.Point(20, 18)
$logo.BackColor = [System.Drawing.Color]::FromArgb(36, 36, 36)
$form.Controls.Add($logo)

$title = New-Object System.Windows.Forms.Label
$title.Text = "LibreHarnes"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(68, 18)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Local AI, on your hardware"
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(139, 139, 139)
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(70, 44)
$form.Controls.Add($subtitle)

$status = New-Object System.Windows.Forms.Label
$status.Text = "Server running"
$status.ForeColor = [System.Drawing.Color]::FromArgb(74, 222, 128)
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(22, 78)
$form.Controls.Add($status)

$link = New-Object System.Windows.Forms.TextBox
$link.Text = Get-DisplayUrl
$link.ReadOnly = $true
$link.BorderStyle = "FixedSingle"
$link.BackColor = [System.Drawing.Color]::FromArgb(20, 20, 20)
$link.ForeColor = [System.Drawing.Color]::FromArgb(236, 236, 236)
$link.Font = New-Object System.Drawing.Font("Consolas", 9)
$link.Location = New-Object System.Drawing.Point(22, 104)
$link.Size = New-Object System.Drawing.Size(376, 24)
$form.Controls.Add($link)

$lan = New-Object System.Windows.Forms.CheckBox
$lan.Text = "Open from other devices on this network"
$lan.AutoSize = $true
$lan.Location = New-Object System.Drawing.Point(22, 136)
$lan.ForeColor = [System.Drawing.Color]::FromArgb(236, 236, 236)
$lan.Checked = $lanOn
$lan.Add_CheckedChanged({
  if ($script:lanSync) { return }
  $target = if ($lan.Checked) { "0.0.0.0" } else { "127.0.0.1" }
  $ok = $false
  try {
    Invoke-WebRequest -Uri "$baseUrl/api/config" -Method POST -Body ('{"host":"' + $target + '"}') -ContentType "application/json" -UseBasicParsing -TimeoutSec 4 | Out-Null
    $ok = $true
  } catch { $ok = $false }
  if (-not $ok) {
    $script:lanSync = $true
    $lan.Checked = -not $lan.Checked
    $script:lanSync = $false
    return
  }
  $script:lanOn = ($target -eq "0.0.0.0")
  $fresh = $null
  # The server re-binds a moment after replying; read the fresh state back.
  Start-Sleep -Milliseconds 700
  for ($i = 0; $i -lt 3 -and -not $fresh; $i++) {
    try { $fresh = Invoke-RestMethod -Uri "$baseUrl/api/config" -TimeoutSec 2 } catch { Start-Sleep -Milliseconds 500 }
  }
  if ($fresh) {
    if ($fresh.lanUrl) { $script:lanUrl = $fresh.lanUrl }
    $script:lanOn = ($fresh.host -eq "0.0.0.0")
    $script:lanSync = $true
    $lan.Checked = $lanOn
    $script:lanSync = $false
  }
  $link.Text = Get-DisplayUrl
})
$form.Controls.Add($lan)

$open = New-Object System.Windows.Forms.Button
$open.Text = "Open LibreHarnes"
$open.Location = New-Object System.Drawing.Point(22, 166)
$open.Size = New-Object System.Drawing.Size(200, 32)
$open.FlatStyle = "Flat"
$open.BackColor = [System.Drawing.Color]::FromArgb(236, 236, 236)
$open.ForeColor = [System.Drawing.Color]::FromArgb(19, 19, 19)
$open.Add_Click({ Start-Process (Get-DisplayUrl) })
$form.Controls.Add($open)

$copy = New-Object System.Windows.Forms.Button
$copy.Text = "Copy link"
$copy.Location = New-Object System.Drawing.Point(230, 166)
$copy.Size = New-Object System.Drawing.Size(168, 32)
$copy.FlatStyle = "Flat"
$copy.BackColor = [System.Drawing.Color]::FromArgb(36, 36, 36)
$copy.ForeColor = [System.Drawing.Color]::FromArgb(236, 236, 236)
$copy.Add_Click({
  [System.Windows.Forms.Clipboard]::SetText((Get-DisplayUrl))
  $copy.Text = "Copied"
})
$form.Controls.Add($copy)

$quit = New-Object System.Windows.Forms.Button
$quit.Text = "Stop server & quit"
$quit.Location = New-Object System.Drawing.Point(22, 208)
$quit.Size = New-Object System.Drawing.Size(376, 30)
$quit.FlatStyle = "Flat"
$quit.BackColor = [System.Drawing.Color]::FromArgb(26, 26, 26)
$quit.ForeColor = [System.Drawing.Color]::FromArgb(139, 139, 139)
$quit.Add_Click({
  try {
    Invoke-WebRequest -Uri "$baseUrl/api/shutdown" -Method POST -Body "{}" -ContentType "application/json" -UseBasicParsing -TimeoutSec 2 | Out-Null
  } catch { }
  $form.Close()
})
$form.Controls.Add($quit)

$form.Add_FormClosing({
  try {
    Invoke-WebRequest -Uri "$baseUrl/api/shutdown" -Method POST -Body "{}" -ContentType "application/json" -UseBasicParsing -TimeoutSec 2 | Out-Null
  } catch { }
})

[void]$form.ShowDialog()
