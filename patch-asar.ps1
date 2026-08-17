#Requires -RunAsAdministrator
# Run as: powershell -ExecutionPolicy Bypass -File .\patch-asar.ps1

$ErrorActionPreference = "Stop"

# Detect install path from registry; fall back to default
$installPath = (Get-ItemProperty `
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "RMPG Flex" } |
    Select-Object -First 1).InstallLocation
if (-not $installPath) { $installPath = "C:\Program Files\RMPG Flex" }
$installPath = $installPath.TrimEnd('\')

$appDir     = "$installPath\resources"
$asarPath   = "$appDir\app.asar"
$extractDir = "$env:TEMP\rmpg-asar-patch"
$timestamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = "$asarPath.$timestamp.bak"
$base       = "https://raw.githubusercontent.com/rmpgutah/rmpg-flex/main/desktop"

# Prerequisite check
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed. Download from https://nodejs.org and re-run."
}

# Install asar CLI via cmd to bypass PowerShell script execution policy on npm.ps1
cmd /c "npm install -g @electron/asar"
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("PATH", "User")

# Stop the app — Electron holds a file lock on app.asar while running
Stop-Process -Name "RMPG Flex" -Force -ErrorAction SilentlyContinue

# Wait for all Electron processes to fully exit before touching the asar
$timeout = 15
$elapsed = 0
while ((Get-Process -Name "RMPG Flex" -ErrorAction SilentlyContinue) -and $elapsed -lt $timeout) {
    Start-Sleep 1
    $elapsed++
}
if (Get-Process -Name "RMPG Flex" -ErrorAction SilentlyContinue) {
    Write-Error "RMPG Flex processes did not exit within $timeout seconds. Aborting."
}

# Clean extract dir from any prior run, then extract
if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
cmd /c "asar extract `"$asarPath`" `"$extractDir`""

# Backup original before any changes so we always have something to restore
Copy-Item "$asarPath" "$backupPath" -Force
Write-Host "Backup saved to $backupPath"

try {
    # Download updated shell files
    foreach ($file in @("main.js", "preload.js", "splash.html", "splashPreload.js")) {
        Write-Host "Downloading $file..."
        Invoke-WebRequest "$base/$file" -OutFile "$extractDir\$file" -UseBasicParsing
    }

    # Repack
    cmd /c "asar pack `"$extractDir`" `"$asarPath`""

    # Verify the new asar contains all four patched files
    $asarList = cmd /c "asar list `"$asarPath`""
    foreach ($file in @("main.js", "preload.js", "splash.html", "splashPreload.js")) {
        if (-not ($asarList -match [regex]::Escape($file))) {
            throw "Verification failed: $file missing from repacked asar."
        }
    }
    Write-Host "Verification passed — all 4 files present in new asar."

    # Cleanup temp files
    Remove-Item $extractDir -Recurse -Force

} catch {
    Write-Host "ERROR: $_"
    Write-Host "Restoring original asar from backup..."
    Copy-Item "$backupPath" "$asarPath" -Force
    Write-Host "Restored. Restarting app with original files."
    Start-Process "$installPath\RMPG Flex.exe"
    exit 1
}

# Restart the app
Start-Process "$installPath\RMPG Flex.exe"
Write-Host "Done. RMPG Flex restarted with updated shell files."
