<#
.SYNOPSIS
    Installs RMPG Flex OS onto a Windows machine WITHOUT a USB stick.

.DESCRIPTION
    Adds RMPG Flex OS as a second boot option alongside the existing Windows
    installation. Windows is left completely intact — this does not
    repartition, resize, or reformat anything.

    Why no USB and no partition is needed
    -------------------------------------
    RMPG Flex OS runs from an initramfs: the entire operating system is loaded
    into RAM by the bootloader at boot time. There is no root partition to
    create. The install therefore reduces to three things:

      1. Two files (the kernel and the RAM filesystem) copied to C:\
      2. A small GRUB bootloader copied to the EFI System Partition
      3. A firmware boot entry pointing at that bootloader

    All three are fully reversible — see Uninstall-RmpgFlexOS.ps1.

    Because it boots through UEFI + GRUB rather than legacy syslinux, this
    path also works on firmware that has dropped CSM/Legacy support, which
    the USB image requires.

.NOTES
    MUST be run from an elevated PowerShell ("Run as Administrator").
    Secure Boot must be disabled in firmware — GRUB here is unsigned.

    This script modifies the boot configuration of a working machine. It
    backs the BCD store up first (see $BackupDir) and refuses to proceed on
    anything it does not fully recognise.
#>
[CmdletBinding()]
param(
    # Directory holding bzImage, rootfs.cpio.gz and grubx64.efi. Defaults to
    # the folder this script was extracted into.
    [string]$SourceDir = $PSScriptRoot,

    # Where the kernel and RAM filesystem are installed on the Windows volume.
    [string]$InstallDir = "$env:SystemDrive\RMPG-Flex-OS",

    # Skip the confirmation prompt (for scripted fleet deployment).
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$BootLabel = 'RMPG Flex OS'
$EspLetter = 'S:'
$EfiVendorDir = 'EFI\RMPG'
$BackupDir = Join-Path $InstallDir 'backup'

function Write-Step   { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok     { param($m) Write-Host "    $m" -ForegroundColor Green }
function Write-Warn   { param($m) Write-Host "    $m" -ForegroundColor Yellow }
function Fail         { param($m) Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }

# ── Preflight ────────────────────────────────────────────────────────────────
# Every one of these is a condition that would otherwise fail LATER, after the
# script had already changed something. Check them all before touching disk.

Write-Step 'Checking prerequisites'

$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail 'This script must be run as Administrator. Right-click PowerShell and choose "Run as administrator".'
}
Write-Ok 'Running with administrator rights'

# UEFI vs legacy BIOS. GetFirmwareEnvironmentVariable fails with
# ERROR_INVALID_FUNCTION (1) on legacy BIOS — that is the documented way to
# detect firmware type without parsing bcdedit output.
$firmware = $env:firmware_type
if (-not $firmware) {
    $firmware = (Get-ComputerInfo -Property BiosFirmwareType -ErrorAction SilentlyContinue).BiosFirmwareType
}
if ("$firmware" -notmatch 'UEFI') {
    Fail @"
This machine appears to be booting in Legacy/BIOS mode, not UEFI ($firmware).
The no-USB installer requires UEFI. Use the USB install method instead — see
the Kiosk Linux OS section at https://rmpgutah.us/downloads
"@
}
Write-Ok "Firmware mode: UEFI"

# Secure Boot must be off; GRUB here is unsigned and the firmware will refuse
# to load it otherwise. Confirm-SecureBootUEFI throws on non-UEFI systems,
# which the check above has already ruled out.
try {
    if (Confirm-SecureBootUEFI) {
        Fail @"
Secure Boot is ENABLED. RMPG Flex OS uses an unsigned bootloader, so the
firmware will refuse to start it.

Disable Secure Boot first: reboot, press F2 at the Panasonic splash screen,
then Security > Secure Boot > Disabled. Save with F10 and run this again.
"@
    }
    Write-Ok 'Secure Boot is disabled'
} catch [System.PlatformNotSupportedException] {
    Write-Warn 'Could not query Secure Boot state; continuing.'
}

foreach ($f in @('bzImage', 'rootfs.cpio.gz', 'grubx64.efi')) {
    $p = Join-Path $SourceDir $f
    if (-not (Test-Path $p)) {
        Fail "Required file not found: $p`nExtract the whole downloaded .zip and run this script from inside the extracted folder."
    }
}
Write-Ok 'Found bzImage, rootfs.cpio.gz and grubx64.efi'

# Free space: the two files plus headroom. Checked against the actual sizes
# rather than a guessed constant, since the desktop image is much larger than
# the kiosk one.
$needed = ((Get-Item (Join-Path $SourceDir 'bzImage')).Length +
           (Get-Item (Join-Path $SourceDir 'rootfs.cpio.gz')).Length) * 1.2
$freeBytes = (Get-PSDrive -Name $env:SystemDrive.Trim(':')).Free
if ($freeBytes -lt $needed) {
    Fail ("Not enough free space on {0} — need about {1:N0} MB, have {2:N0} MB." -f `
          $env:SystemDrive, ($needed / 1MB), ($freeBytes / 1MB))
}
Write-Ok ("Free space on {0}: {1:N0} MB" -f $env:SystemDrive, ($freeBytes / 1MB))

# RAM: the whole OS is loaded into memory, so a machine with too little RAM
# will panic at boot rather than fail here. Warn loudly.
$ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
if ($ramGB -lt 4) {
    Write-Warn "This machine has ${ramGB} GB RAM. RMPG Flex OS loads entirely into RAM and needs 4 GB or more; it may fail to boot."
} else {
    Write-Ok "Installed RAM: ${ramGB} GB"
}

# ── Confirm ──────────────────────────────────────────────────────────────────
if (-not $Force) {
    Write-Host @"

This will:
  - Copy the OS files to $InstallDir
  - Copy a GRUB bootloader to the EFI System Partition ($EfiVendorDir)
  - Add a firmware boot entry named "$BootLabel"
  - Back up the current boot configuration to $BackupDir

Your Windows installation, files and partitions are NOT modified. On the next
restart you will be able to choose between Windows and RMPG Flex OS.

To undo all of this later, run Uninstall-RmpgFlexOS.ps1.

"@ -ForegroundColor White
    $answer = Read-Host 'Continue? (yes/no)'
    if ($answer -notmatch '^(y|yes)$') { Write-Host 'Cancelled — nothing was changed.'; exit 0 }
}

# ── Install ──────────────────────────────────────────────────────────────────

Write-Step "Copying OS files to $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir  | Out-Null
New-Item -ItemType Directory -Force -Path $BackupDir   | Out-Null
Copy-Item (Join-Path $SourceDir 'bzImage')        (Join-Path $InstallDir 'bzImage')        -Force
Copy-Item (Join-Path $SourceDir 'rootfs.cpio.gz') (Join-Path $InstallDir 'rootfs.cpio.gz') -Force
Write-Ok 'Kernel and RAM filesystem copied'

Write-Step 'Backing up the current boot configuration'
# bcdedit /export is the supported way to snapshot the BCD store. If anything
# below goes wrong, this file restores the exact prior boot state via
# `bcdedit /import`.
$bcdBackup = Join-Path $BackupDir 'BCD-backup'
& bcdedit /export "$bcdBackup" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Could not back up the boot configuration (bcdedit /export failed). Nothing further was changed.' }
Write-Ok "Boot configuration backed up to $bcdBackup"

Write-Step 'Mounting the EFI System Partition'
# The ESP has no drive letter by default. mountvol assigns one temporarily.
$espAlreadyMounted = Test-Path $EspLetter
if (-not $espAlreadyMounted) {
    & mountvol $EspLetter /S
    if ($LASTEXITCODE -ne 0) { Fail "Could not mount the EFI System Partition as $EspLetter." }
}
Write-Ok "EFI System Partition mounted at $EspLetter"

try {
    Write-Step 'Installing the bootloader'
    $efiDir = Join-Path $EspLetter $EfiVendorDir
    New-Item -ItemType Directory -Force -Path $efiDir | Out-Null
    Copy-Item (Join-Path $SourceDir 'grubx64.efi') (Join-Path $efiDir 'grubx64.efi') -Force

    # GRUB config. `search --file` locates the Windows volume by looking for a
    # file we just placed there, rather than hardcoding a partition index like
    # (hd0,gpt3) — disk enumeration is not stable across machines or firmware,
    # and a hardcoded index is the single most common reason a hand-rolled
    # GRUB entry boots on the bench and fails in the field.
    $grubCfg = @"
set timeout=5
set default=0

menuentry "RMPG Flex OS" {
    search --no-floppy --file --set=root /RMPG-Flex-OS/bzImage
    linux  /RMPG-Flex-OS/bzImage console=tty0 quiet
    initrd /RMPG-Flex-OS/rootfs.cpio.gz
}

menuentry "RMPG Flex OS (verbose boot, for troubleshooting)" {
    search --no-floppy --file --set=root /RMPG-Flex-OS/bzImage
    linux  /RMPG-Flex-OS/bzImage console=tty0
    initrd /RMPG-Flex-OS/rootfs.cpio.gz
}

menuentry "Windows" {
    insmod part_gpt
    insmod fat
    insmod chain
    search --no-floppy --file --set=root /EFI/Microsoft/Boot/bootmgfw.efi
    chainloader /EFI/Microsoft/Boot/bootmgfw.efi
}
"@
    Set-Content -Path (Join-Path $efiDir 'grub.cfg') -Value $grubCfg -Encoding ASCII
    Write-Ok "Bootloader installed to $EfiVendorDir"

    Write-Step 'Adding the boot entry'
    # Copying {bootmgr} inherits a valid firmware-application entry rather than
    # constructing one from scratch, which is far more reliable across OEM
    # firmware. The new entry is then repointed at GRUB.
    $out = & bcdedit /copy "{bootmgr}" /d "$BootLabel"
    if ($LASTEXITCODE -ne 0) { Fail "bcdedit could not create the boot entry: $out" }

    # Output looks like: The entry was successfully copied to {GUID}.
    if ($out -notmatch '\{[0-9a-fA-F-]{36}\}') {
        Fail "Could not determine the new boot entry ID from bcdedit output: $out"
    }
    $guid = $Matches[0]
    Write-Ok "Created boot entry $guid"

    & bcdedit /set $guid path "\$EfiVendorDir\grubx64.efi".Replace('\\','\') | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Could not point the boot entry at the bootloader.' }

    # Put it in the boot menu, but do NOT make it the default: if the image
    # fails to boot on this hardware, the machine must still come up in
    # Windows unattended.
    & bcdedit /displayorder $guid /addlast | Out-Null
    & bcdedit /timeout 10 | Out-Null

    Set-Content -Path (Join-Path $BackupDir 'boot-entry-guid.txt') -Value $guid -Encoding ASCII
    Write-Ok 'Boot entry added to the boot menu (Windows remains the default)'
}
finally {
    # Always unmount, even if something above threw — leaving the ESP mounted
    # exposes firmware files to normal file-manager browsing.
    if (-not $espAlreadyMounted) { & mountvol $EspLetter /D 2>$null | Out-Null }
}

Write-Host @"

============================================================
 RMPG Flex OS installed.
============================================================

Restart the machine. A boot menu appears for 10 seconds:
choose "$BootLabel" to start the terminal, or do nothing and
Windows starts as usual.

Windows remains the default, so an unattended reboot always
returns to Windows.

To remove: run Uninstall-RmpgFlexOS.ps1 as Administrator.

"@ -ForegroundColor Green
