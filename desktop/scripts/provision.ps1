#Requires -RunAsAdministrator
# ============================================================
# RMPG Flex — Toughbook Provisioning Script
# Rocky Mountain Protective Group
#
# Downloads and silently installs the latest RMPG Flex from
# the live update feed. Run once on a fresh Toughbook or any
# new Windows machine. Subsequent updates are handled
# automatically by the app's built-in electron-updater.
#
# Usage (run as Administrator in PowerShell):
#   .\provision.ps1                          # install only
#   .\provision.ps1 -KioskMode               # install + enable FlexOS kiosk shell
#   .\provision.ps1 -InstallDir "D:\RMPG"   # custom install path
#   .\provision.ps1 -Quiet                   # suppress progress output
# ============================================================

param(
    [switch]$KioskMode,
    [string]$InstallDir = "C:\Program Files\RMPG Flex",
    [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$FeedBase   = "https://api.rmpgutah.us/updates"
$TempDir    = Join-Path $env:TEMP "rmpg-flex-provision-$(Get-Date -Format 'yyyyMMddHHmmss')"
$LogFile    = Join-Path $env:TEMP "rmpg-flex-provision.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[$((Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))] [$Level] $Message"
    Add-Content -Path $LogFile -Value $line
    if (-not $Quiet) {
        switch ($Level) {
            "ERROR" { Write-Host $line -ForegroundColor Red }
            "WARN"  { Write-Host $line -ForegroundColor Yellow }
            default { Write-Host $line }
        }
    }
}

function Exit-WithError {
    param([string]$Message)
    Write-Log $Message "ERROR"
    Write-Host "`nProvisioning FAILED. See log: $LogFile" -ForegroundColor Red
    exit 1
}

# ─── Start ───────────────────────────────────────────────────

Write-Log "Rocky Mountain Protective Group — RMPG Flex Provisioning"
Write-Log "Feed: $FeedBase"
Write-Log "Install dir: $InstallDir"
Write-Log "Kiosk mode: $KioskMode"

# ─── Step 1: Read the latest.yml manifest ─────────────────────

Write-Log "Fetching update manifest..."
$manifestUrl = "$FeedBase/latest.yml"
$manifestPath = Join-Path $TempDir "latest.yml"

New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
try {
    Invoke-WebRequest -Uri $manifestUrl -OutFile $manifestPath -UseBasicParsing
} catch {
    Exit-WithError "Failed to fetch manifest from $manifestUrl`: $_"
}

# Parse the manifest — electron-builder latest.yml format:
#   path: RMPG-Flex-Setup-x.y.z.exe
#   sha512: <base64>
#   version: x.y.z
$manifest = Get-Content $manifestPath -Raw
$versionMatch = [regex]::Match($manifest, 'version:\s*(.+)')
$pathMatch    = [regex]::Match($manifest, 'path:\s*(.+)')
$sha512Match  = [regex]::Match($manifest, 'sha512:\s*(.+)')

if (-not $versionMatch.Success -or -not $pathMatch.Success -or -not $sha512Match.Success) {
    Exit-WithError "Could not parse latest.yml — unexpected format."
}

$remoteVersion = $versionMatch.Groups[1].Value.Trim()
$installerName = $pathMatch.Groups[1].Value.Trim()
$expectedSha512 = $sha512Match.Groups[1].Value.Trim()

Write-Log "Latest version: $remoteVersion"
Write-Log "Installer: $installerName"

# ─── Step 2: Check if already at this version ─────────────────

$uninstallKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
$existingVersion = $null
Get-ChildItem $uninstallKey -ErrorAction SilentlyContinue | ForEach-Object {
    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($props.DisplayName -eq "RMPG Flex") {
        $existingVersion = $props.DisplayVersion
    }
}

if ($existingVersion -eq $remoteVersion) {
    Write-Log "RMPG Flex $remoteVersion is already installed. Nothing to do."
    if (-not $KioskMode) { exit 0 }
    Write-Log "KioskMode flag set — skipping to kiosk configuration."
} else {
    if ($existingVersion) {
        Write-Log "Upgrading from $existingVersion to $remoteVersion..."
    } else {
        Write-Log "Fresh install of $remoteVersion..."
    }

    # ─── Step 3: Download installer ──────────────────────────────

    $installerUrl  = "$FeedBase/$installerName"
    $installerPath = Join-Path $TempDir $installerName

    Write-Log "Downloading installer ($installerUrl)..."
    try {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($installerUrl, $installerPath)
    } catch {
        Exit-WithError "Download failed: $_"
    }

    # ─── Step 4: Verify SHA-512 ───────────────────────────────────

    Write-Log "Verifying integrity..."
    $hash = (Get-FileHash -Path $installerPath -Algorithm SHA512).Hash
    # expected is base64; convert our hex to base64 for comparison
    $hashBytes  = [byte[]] ($hash -split '(..)' | Where-Object { $_ } | ForEach-Object { [Convert]::ToByte($_, 16) })
    $hashBase64 = [Convert]::ToBase64String($hashBytes)

    if ($hashBase64 -ne $expectedSha512) {
        Exit-WithError "SHA-512 mismatch — installer may be corrupt or tampered. Aborting."
    }
    Write-Log "Integrity check passed."

    # ─── Step 5: Silent install ───────────────────────────────────

    Write-Log "Running silent install (this may take 30-60 s)..."
    # NSIS flags: /S = silent, /D = install directory (must be last, no quotes)
    $installArgs = "/S /D=$InstallDir"
    $proc = Start-Process -FilePath $installerPath -ArgumentList $installArgs -Wait -PassThru

    if ($proc.ExitCode -ne 0) {
        Exit-WithError "Installer exited with code $($proc.ExitCode)."
    }
    Write-Log "Install completed successfully."
}

# ─── Step 6: Kiosk shell mode (optional) ──────────────────────

if ($KioskMode) {
    Write-Log "Configuring FlexOS kiosk shell mode..."

    # The Winlogon Shell registry key. RMPG Flex registers itself here
    # when kiosk mode is enabled via the in-app Settings. We write it
    # directly here so the first boot after provisioning goes straight
    # into FlexOS without requiring an interactive admin session first.
    $exePath = Join-Path $InstallDir "RMPG Flex.exe"
    if (-not (Test-Path $exePath)) {
        # Try the default NSIS install path
        $exePath = Join-Path "C:\Program Files\RMPG Flex" "RMPG Flex.exe"
    }
    if (-not (Test-Path $exePath)) {
        Write-Log "Could not find RMPG Flex.exe for kiosk shell registration — set manually in app Settings." "WARN"
    } else {
        $shellValue = "`"$exePath`" --kiosk-shell"
        $winlogonPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
        Set-ItemProperty -Path $winlogonPath -Name "Shell" -Value $shellValue -Type String
        Write-Log "Winlogon Shell set to: $shellValue"
        Write-Log "Machine will boot directly into RMPG Flex on next login."
    }
}

# ─── Step 7: Create provisioning marker ───────────────────────

$markerDir = Join-Path $env:ProgramData "RMPG Flex"
New-Item -ItemType Directory -Path $markerDir -Force | Out-Null
$marker = [PSCustomObject]@{
    provisioned_at  = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
    version         = $remoteVersion
    kiosk_mode      = $KioskMode.IsPresent
    install_dir     = $InstallDir
    provisioned_by  = "provision.ps1"
}
$marker | ConvertTo-Json | Set-Content -Path (Join-Path $markerDir "provision.json") -Encoding UTF8

# ─── Cleanup ──────────────────────────────────────────────────

Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Log "Provisioning complete. RMPG Flex $remoteVersion is ready."
Write-Host "`n✓ RMPG Flex $remoteVersion installed successfully." -ForegroundColor Green
if ($KioskMode) {
    Write-Host "✓ FlexOS kiosk mode enabled — reboot to activate." -ForegroundColor Green
}
Write-Host "  Log: $LogFile"
