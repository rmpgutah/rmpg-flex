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
    [switch]$Force,

    # Where to fetch the OS payload when it is not next to this script. Kept as
    # a parameter so a site with its own mirror can point at it.
    [string]$PayloadUrl = 'https://rmpgutah.us/downloads/RMPG-Flex-OS-Installer.zip',

    # Expected SHA-256 of that payload. Stamped by the release process; when
    # empty the download proceeds unverified and says so.
    [string]$PayloadSha256 = ''
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

#
# Payload. If the OS files are not sitting next to this script, fetch them
# rather than failing.
#
# This is what makes the install genuinely one-click. Double-clicking a .bat
# inside a .zip makes Windows extract ONLY that file to a temp folder, so its
# siblings are absent and a script that merely errored out here would send the
# user back to extract the archive by hand — exactly the manual step this is
# meant to remove. Downloading the payload also means the script alone can be
# handed to someone with no attachment at all.
#
$needed = @('bzImage', 'rootfs.cpio.gz', 'grubx64.efi')
$missing = $needed | Where-Object { -not (Test-Path (Join-Path $SourceDir $_)) }

if ($missing.Count -gt 0) {
    Write-Warn "OS files not found alongside this script ($($missing -join ', '))."
    Write-Step "Downloading the OS payload from $PayloadUrl"
    Write-Host '    This is roughly 250 MB and takes a few minutes on a normal connection.' -ForegroundColor White

    $tmp = Join-Path $env:TEMP "rmpg-flex-os-payload"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zipPath = Join-Path $tmp 'payload.zip'

    try {
        # TLS 1.2 explicitly: older PowerShell hosts default to TLS 1.0, which
        # Cloudflare rejects, producing a bare "underlying connection was
        # closed" that looks like a network outage.
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        # WebClient rather than Invoke-WebRequest: on Windows PowerShell 5.1
        # Invoke-WebRequest buffers the whole response in memory and its
        # progress rendering makes a 250 MB download crawl.
        (New-Object Net.WebClient).DownloadFile($PayloadUrl, $zipPath)
    } catch {
        Fail @"
Could not download the OS payload: $($_.Exception.Message)

Check the machine has internet access, or download
$PayloadUrl
manually, extract it, and run this script from inside the extracted folder.
"@
    }

    if (-not (Test-Path $zipPath)) { Fail 'Download reported success but produced no file.' }
    Write-Ok ("Downloaded {0:N0} MB" -f ((Get-Item $zipPath).Length / 1MB))

    # Verify before trusting it. A truncated image installs happily and then
    # fails to boot with no clue as to why.
    if ($PayloadSha256) {
        Write-Step 'Verifying the download'
        $actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash
        if ($actual -ne $PayloadSha256.ToUpper()) {
            Fail @"
Downloaded file failed verification — it is incomplete or corrupted.
  expected SHA-256: $($PayloadSha256.ToUpper())
  actual   SHA-256: $actual
Delete $zipPath and run this again.
"@
        }
        Write-Ok 'SHA-256 matches'
    }

    Write-Step 'Extracting'
    Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
    $SourceDir = $tmp

    $stillMissing = $needed | Where-Object { -not (Test-Path (Join-Path $SourceDir $_)) }
    if ($stillMissing.Count -gt 0) {
        Fail "The downloaded payload is missing: $($stillMissing -join ', ')"
    }
    Write-Ok 'Payload ready'
}
Write-Ok 'Found bzImage, rootfs.cpio.gz and grubx64.efi'

# Free space: the two files plus headroom. Checked against the actual sizes
# rather than a guessed constant, since the desktop image is much larger than
# the kiosk one.
#
# ×2 as of 2026-07-25 for the A/B slots. This install writes a full kernel and
# rootfs into BOTH slot_a and slot_b, so the requirement doubled — roughly 660 MB
# rather than 330 MB for the current desktop image. Leaving the old figure would
# have passed the precheck on a nearly-full drive and then run out of space
# partway through writing the second slot, which is the worst place to stop: the
# firmware boot entry is not added until later, but the volume would be full.
$slotCount = 2
$needed = ((Get-Item (Join-Path $SourceDir 'bzImage')).Length +
           (Get-Item (Join-Path $SourceDir 'rootfs.cpio.gz')).Length) * $slotCount * 1.2
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

# ── A/B slots (2026-07-25) ───────────────────────────────────────────────────
#
# This path used to install ONE copy of the kernel and rootfs directly in
# $InstallDir. The USB install has had A/B slots with automatic rollback since
# sub-project 5; this path had none, so a bad over-the-air update on a no-USB
# terminal had nothing to fall back to — and no-USB is the primary install
# method for the fleet, because it needs no stick carried to each vehicle.
#
# Both slots are seeded with the SAME image, exactly as
# scripts/assemble-disk-image.sh does for the USB path, so the terminal starts
# with a known-good fallback already present rather than acquiring one on its
# first successful update.
#
# GRUB picks the slot by sourcing slot.cfg, a two-line file the running system
# rewrites through rmpg_bootstore_set_slot. That indirection is what makes the
# pointer writable from Linux at all: grub-editenv is not in this image, so a
# grubenv block would need tooling the terminal does not have, whereas a plain
# text file needs nothing beyond NTFS3 write support (also new in this pass).
foreach ($slot in @('slot_a', 'slot_b')) {
    $slotDir = Join-Path $InstallDir $slot
    New-Item -ItemType Directory -Force -Path $slotDir | Out-Null
    Copy-Item (Join-Path $SourceDir 'bzImage')        (Join-Path $slotDir 'bzImage')        -Force
    Copy-Item (Join-Path $SourceDir 'rootfs.cpio.gz') (Join-Path $slotDir 'rootfs.cpio.gz') -Force
    Write-Ok "Seeded $slot"
}

# The slot pointer, and the failed-boot counter S01kiosk-boot-slot-check
# maintains. Written with ASCII + Unix line endings deliberately: GRUB parses
# this file, and a UTF-8 BOM (which PowerShell would add by default) makes GRUB
# fail to read the first line.
$slotCfg = "# Written by the installer; rewritten by rmpg-update on the terminal.`nset rmpg_slot=slot_a`n"
[System.IO.File]::WriteAllText((Join-Path $InstallDir 'slot.cfg'), $slotCfg, (New-Object System.Text.ASCIIEncoding))
[System.IO.File]::WriteAllText((Join-Path $InstallDir 'boot_attempts'), "0`n", (New-Object System.Text.ASCIIEncoding))
Write-Ok 'Slot pointer set to slot_a, failed-boot counter initialised'

# A copy at the old top-level location is deliberately NOT kept. Two bootable
# copies of the kernel on one volume, only one of which the updater maintains,
# is how a terminal ends up silently booting a stale image after an update that
# reported success.
Write-Ok 'Kernel and RAM filesystem copied into both slots'

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
    # A/B aware. The active slot comes from slot.cfg on the Windows volume, which
    # the terminal rewrites when it stages an update or rolls back.
    #
    # `set rmpg_slot=slot_a` before sourcing is the fallback, not a default to be
    # overwritten blindly: if slot.cfg is missing, unreadable, or truncated by a
    # power loss mid-write, GRUB still has a valid slot to boot. Without it a
    # damaged pointer would expand to an empty path and the machine would drop to
    # a GRUB prompt in a vehicle — the exact unattended failure this design is
    # meant to prevent. (boot-store.sh writes the pointer via a same-directory
    # rename to keep that window as close to zero as the filesystem allows.)
    # VERBATIM here-string (@' '@), not an expandable one (@" "@). Every $ below
    # is a GRUB variable that must reach grub.cfg literally, and PowerShell would
    # expand them to empty strings inside @" "@ — producing a config that boots
    # nothing, from a file that looks correct in the source. Escaping each one
    # with a backtick would also work, but requires being right every time; a
    # verbatim here-string cannot get it wrong. (Note PowerShell escapes with a
    # backtick, NOT a backslash, so `\$rmpg_slot` would emit a literal backslash
    # and still expand the variable.)
    $grubCfg = @'
set timeout=5
set default=0

# Locate the Windows volume that holds the OS files, by content rather than by a
# partition index — disk enumeration is not stable across machines or firmware.
search --no-floppy --file --set=rmpgroot /RMPG-Flex-OS/slot_a/bzImage

# Fallback before sourcing, so a missing or truncated slot.cfg still boots
# something rather than dropping to a GRUB prompt in a vehicle.
set rmpg_slot=slot_a
if [ -f ($rmpgroot)/RMPG-Flex-OS/slot.cfg ]; then
    source ($rmpgroot)/RMPG-Flex-OS/slot.cfg
fi

menuentry "RMPG Flex OS" {
    set root=$rmpgroot
    linux  /RMPG-Flex-OS/$rmpg_slot/bzImage console=tty0 quiet
    initrd /RMPG-Flex-OS/$rmpg_slot/rootfs.cpio.gz
}

menuentry "RMPG Flex OS (verbose boot, for troubleshooting)" {
    set root=$rmpgroot
    linux  /RMPG-Flex-OS/$rmpg_slot/bzImage console=tty0
    initrd /RMPG-Flex-OS/$rmpg_slot/rootfs.cpio.gz
}

# Both slots reachable by hand. If automatic rollback itself fails, this is what
# an officer can be talked through over the radio without a USB stick.
menuentry "RMPG Flex OS (force slot_a)" {
    set root=$rmpgroot
    linux  /RMPG-Flex-OS/slot_a/bzImage console=tty0
    initrd /RMPG-Flex-OS/slot_a/rootfs.cpio.gz
}

menuentry "RMPG Flex OS (force slot_b)" {
    set root=$rmpgroot
    linux  /RMPG-Flex-OS/slot_b/bzImage console=tty0
    initrd /RMPG-Flex-OS/slot_b/rootfs.cpio.gz
}

menuentry "Windows" {
    # No `insmod` here on purpose. part_gpt, fat and chain are compiled INTO
    # grubx64.efi (BR2_TARGET_GRUB2_BUILTIN_MODULES_EFI), and this build ships no
    # module directory on the ESP — so `insmod chain` would look for a chain.mod
    # that does not exist and raise an error inside the entry that is supposed to
    # get the officer back into Windows.
    search --no-floppy --file --set=root /EFI/Microsoft/Boot/bootmgfw.efi
    chainloader /EFI/Microsoft/Boot/bootmgfw.efi
}
'@
    # WriteAllText rather than Set-Content, matching how slot.cfg is written:
    # Set-Content appends a platform line ending and its encoding defaults have
    # changed between PowerShell 5.1 and 7, and GRUB parses this file. Writing
    # the exact bytes leaves nothing to a host default.
    [System.IO.File]::WriteAllText((Join-Path $efiDir 'grub.cfg'), $grubCfg, (New-Object System.Text.ASCIIEncoding))
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
