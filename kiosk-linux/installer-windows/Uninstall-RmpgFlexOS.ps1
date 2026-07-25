<#
.SYNOPSIS
    Removes RMPG Flex OS from a Windows machine, restoring the original boot
    configuration.

.DESCRIPTION
    Undoes everything Install-RmpgFlexOS.ps1 did: deletes the firmware boot
    entry, removes the bootloader from the EFI System Partition, and deletes
    the OS files. Windows is untouched throughout.

    Deliberately continues past individual failures rather than stopping at
    the first one. A half-installed machine is the most likely reason someone
    runs this, so getting as far as possible and reporting what could not be
    removed is more useful than aborting.

.NOTES
    Run from an elevated PowerShell ("Run as Administrator").
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:SystemDrive\RMPG-Flex-OS",
    [switch]$Force
)

$BootLabel    = 'RMPG Flex OS'
$EspLetter    = 'S:'
$EfiVendorDir = 'EFI\RMPG'
$BackupDir    = Join-Path $InstallDir 'backup'

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "    $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "    $m" -ForegroundColor Yellow }

$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'ERROR: must be run as Administrator.' -ForegroundColor Red
    exit 1
}

if (-not $Force) {
    Write-Host "`nThis removes the RMPG Flex OS boot entry and its files. Windows is not affected.`n" -ForegroundColor White
    if ((Read-Host 'Continue? (yes/no)') -notmatch '^(y|yes)$') { Write-Host 'Cancelled.'; exit 0 }
}

$problems = @()

# ── Boot entry ───────────────────────────────────────────────────────────────
Write-Step 'Removing the boot entry'
$guidFile = Join-Path $BackupDir 'boot-entry-guid.txt'
$guid = $null
if (Test-Path $guidFile) {
    $guid = (Get-Content $guidFile -Raw).Trim()
}
if (-not $guid) {
    # Fall back to locating it by description. Someone may have deleted the
    # install directory before running this.
    $enum = & bcdedit /enum firmware 2>$null
    $current = $null
    foreach ($line in $enum) {
        if ($line -match '^identifier\s+(\{[0-9a-fA-F-]{36}\})') { $current = $Matches[1] }
        if ($line -match [regex]::Escape($BootLabel) -and $current) { $guid = $current; break }
    }
}

if ($guid) {
    & bcdedit /delete $guid /f 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Deleted boot entry $guid" }
    else { $problems += "Could not delete boot entry $guid"; Write-Warn "Could not delete boot entry $guid" }
} else {
    Write-Warn 'No boot entry found (already removed?)'
}

# ── Bootloader ───────────────────────────────────────────────────────────────
Write-Step 'Removing the bootloader from the EFI System Partition'
$espAlreadyMounted = Test-Path $EspLetter
if (-not $espAlreadyMounted) { & mountvol $EspLetter /S 2>$null }
try {
    $efiDir = Join-Path $EspLetter $EfiVendorDir
    if (Test-Path $efiDir) {
        Remove-Item $efiDir -Recurse -Force
        Write-Ok "Removed $EfiVendorDir"
    } else {
        Write-Warn 'Bootloader directory not present (already removed?)'
    }
} catch {
    $problems += "Could not remove $EfiVendorDir : $_"
    Write-Warn "Could not remove $EfiVendorDir : $_"
} finally {
    if (-not $espAlreadyMounted) { & mountvol $EspLetter /D 2>$null | Out-Null }
}

# ── OS files ─────────────────────────────────────────────────────────────────
Write-Step 'Removing OS files'
# The BCD backup is kept deliberately — if the boot entry removal above failed,
# it is the recovery path, and it is only a few hundred kilobytes.
foreach ($f in @('bzImage', 'rootfs.cpio.gz')) {
    $p = Join-Path $InstallDir $f
    if (Test-Path $p) { Remove-Item $p -Force; Write-Ok "Removed $f" }
}
if (Test-Path $BackupDir) {
    Write-Warn "Kept the boot-configuration backup at $BackupDir (safe to delete once the machine has rebooted normally)"
} elseif (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
}

if ($problems.Count -gt 0) {
    Write-Host "`nFinished with problems:" -ForegroundColor Yellow
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    Write-Host "`nIf the machine will not boot Windows normally, restore the saved boot configuration from a recovery prompt:" -ForegroundColor Yellow
    Write-Host "  bcdedit /import `"$BackupDir\BCD-backup`"" -ForegroundColor Yellow
    exit 1
}

Write-Host "`nRMPG Flex OS removed. Windows boots normally on the next restart.`n" -ForegroundColor Green
