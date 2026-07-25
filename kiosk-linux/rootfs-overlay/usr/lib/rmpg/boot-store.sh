# /usr/lib/rmpg/boot-store.sh — shared persistent-store discovery.
# POSIX sh (BusyBox ash). Sourced, not executed:
#     . /usr/lib/rmpg/boot-store.sh
#
# ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
#
# The root filesystem is an initramfs, so it is RAM only and forgets everything
# on reboot. Two things must survive a reboot for this terminal to be safe
# unattended: the failed-boot counter that drives A/B rollback, and the slot
# pointer the bootloader reads. Both live on a persistent "boot store".
#
# Until 2026-07-25 both S01kiosk-boot-slot-check and rmpg-update found that
# store by hardcoding `mount -t ext2 /dev/vda1`. That device name is a QEMU
# virtio artifact. On an actual Panasonic Toughbook FZ-55 the store is on
# /dev/nvme0n1p1 or /dev/sda1, and on the no-USB install path it is a directory
# on the Windows NTFS volume. The consequence was invisible in every test:
#
#   - QEMU: /dev/vda1 mounts, boot counting works, rollback works, OTA works.
#   - Real FZ-55: the mount fails, S01 logs a warning and exits 0, so the
#     failed-boot counter never increments and A/B rollback NEVER FIRES. Every
#     terminal in the fleet silently loses the unattended-recovery guarantee
#     the A/B design exists to provide.
#   - Real FZ-55, no-USB install: rmpg-update dies at require_boot_mount, so
#     OTA updates cannot run AT ALL on the primary install path.
#
# So this file exists to make one question — "where is the persistent store?" —
# answered once, by probing, in a way both flavours of install share.
#
# ── THE TWO STORE FLAVOURS ───────────────────────────────────────────────────
#
#   extlinux  USB/disk install (scripts/assemble-disk-image.sh): an EXT2
#             partition labelled kiosk_boot holding extlinux.conf plus slot_a/
#             and slot_b/. Slot pointer = the `DEFAULT <slot>` line.
#
#   grubntfs  No-USB install (installer-windows/Install-RmpgFlexOS.ps1): a
#             directory RMPG-Flex-OS/ on the existing Windows NTFS volume,
#             holding slot_a/, slot_b/ and slot.cfg, booted by GRUB EFI.
#             Slot pointer = the `set rmpg_slot=<slot>` line in slot.cfg.
#
# Discovery is by MARKER FILE, not by device name or filesystem label. A label
# lookup would need blkid or findfs, whose BusyBox applets are not guaranteed to
# be built in, and a device name is exactly the assumption that broke. Probing
# for the marker is self-validating: whatever mounts and contains our layout IS
# our store, on any controller, in any enumeration order.
#
# ── TESTABILITY ──────────────────────────────────────────────────────────────
#
# The NTFS path cannot be exercised in QEMU (no Windows volume) and the NVMe
# path needs a non-virtio disk, so the seams below are overridable to let
# test/test-boot-store.sh drive the whole decision tree on a host with fake
# devices. Production never sets them.
#
#   RMPG_BOOTSTORE_PROC_PARTITIONS  device enumeration source (/proc/partitions)
#   RMPG_BOOTSTORE_DEV_DIR          directory device nodes live in (/dev)
#   RMPG_BOOTSTORE_MOUNT_CMD        mount program (mount)
#   RMPG_BOOTSTORE_UMOUNT_CMD       umount program (umount)
#   RMPG_BOOTSTORE_MOUNT_POINT      where to mount it (/mnt/kiosk-boot)
#
# ── PUBLIC INTERFACE ─────────────────────────────────────────────────────────
#
#   rmpg_bootstore_find        0 = found and mounted; sets the vars below
#   rmpg_bootstore_rw / _ro    flip the mount read-write / read-only
#   rmpg_bootstore_get_slot    echoes slot_a|slot_b (empty if unreadable)
#   rmpg_bootstore_set_slot X  rewrites the pointer for the active flavour
#   rmpg_bootstore_other_slot  echoes the slot that is not the current one
#
# After a successful find:
#   RMPG_BOOTSTORE_KIND    extlinux | grubntfs
#   RMPG_BOOTSTORE_DEV     backing device
#   RMPG_BOOTSTORE_MP      mount point
#   RMPG_BOOTSTORE_DIR     directory holding slot_a/, slot_b/, boot_attempts
#   RMPG_BOOTSTORE_RO      1 if it could only be mounted read-only

RMPG_BOOTSTORE_MOUNT_POINT="${RMPG_BOOTSTORE_MOUNT_POINT:-/mnt/kiosk-boot}"
_rmpg_bs_procparts="${RMPG_BOOTSTORE_PROC_PARTITIONS:-/proc/partitions}"
_rmpg_bs_devdir="${RMPG_BOOTSTORE_DEV_DIR:-/dev}"
_rmpg_bs_mount="${RMPG_BOOTSTORE_MOUNT_CMD:-mount}"
_rmpg_bs_umount="${RMPG_BOOTSTORE_UMOUNT_CMD:-umount}"

RMPG_BOOTSTORE_KIND=""
RMPG_BOOTSTORE_DEV=""
RMPG_BOOTSTORE_MP=""
RMPG_BOOTSTORE_DIR=""
RMPG_BOOTSTORE_RO=0

# Logs go to the serial console so a hardware bring-up boot explains itself
# without anyone needing to get a shell on the unit.
rmpg_bootstore_log() { echo "KIOSK_LINUX_BOOTSTORE $*"; }

# Identify an already-mounted directory as one of the two flavours.
# Echoes "KIND DIR", or nothing when it is neither.
_rmpg_bs_identify() {
    _mp="$1"
    if [ -f "$_mp/extlinux.conf" ]; then
        echo "extlinux $_mp"
        return 0
    fi
    # Windows volumes are case-insensitive but ntfs3 presents the name as
    # stored, and the installer creates it capitalised. Accept either so a
    # hand-repaired install still works.
    for _d in "$_mp/RMPG-Flex-OS" "$_mp/rmpg-flex-os"; do
        if [ -d "$_d" ]; then
            echo "grubntfs $_d"
            return 0
        fi
    done
    return 1
}

# Candidate devices, most-likely-first. Whole disks are included deliberately:
# a mount attempt against one simply fails, and excluding them would mean
# re-encoding partition-naming rules per controller, which is the same class of
# assumption that caused this bug.
_rmpg_bs_candidates() {
    [ -r "$_rmpg_bs_procparts" ] || return 0
    # /proc/partitions columns: major minor #blocks name
    awk 'NR > 2 && $4 != "" { print $4 }' "$_rmpg_bs_procparts" | while read -r _name; do
        case "$_name" in
            loop*|ram*|zram*|dm-*|sr*|md*) continue ;;
        esac
        echo "$_rmpg_bs_devdir/$_name"
    done
}

# Try to mount one device read-only and see whether it is our store.
# Leaves it mounted on success; always unmounts on failure.
_rmpg_bs_try() {
    _dev="$1"
    [ -e "$_dev" ] || return 1

    # ext2 first (the USB/disk store), then ntfs3 (the Windows volume). An
    # explicit -t avoids BusyBox mount walking /proc/filesystems and picking a
    # driver that mounts the volume but not the way we need it.
    for _fs in ext2 ext4 ntfs3; do
        if $_rmpg_bs_mount -t "$_fs" -o ro "$_dev" "$RMPG_BOOTSTORE_MOUNT_POINT" 2>/dev/null; then
            if _found="$(_rmpg_bs_identify "$RMPG_BOOTSTORE_MOUNT_POINT")"; then
                RMPG_BOOTSTORE_KIND="${_found%% *}"
                RMPG_BOOTSTORE_DIR="${_found#* }"
                RMPG_BOOTSTORE_DEV="$_dev"
                RMPG_BOOTSTORE_MP="$RMPG_BOOTSTORE_MOUNT_POINT"
                RMPG_BOOTSTORE_RO=1
                return 0
            fi
            $_rmpg_bs_umount "$RMPG_BOOTSTORE_MOUNT_POINT" 2>/dev/null || true
        fi
    done
    return 1
}

rmpg_bootstore_find() {
    # Already located earlier in this same shell.
    if [ -n "$RMPG_BOOTSTORE_DIR" ] && [ -d "$RMPG_BOOTSTORE_DIR" ]; then
        return 0
    fi

    mkdir -p "$RMPG_BOOTSTORE_MOUNT_POINT" 2>/dev/null || true

    # Another script in an earlier init stage may have mounted it already.
    if _found="$(_rmpg_bs_identify "$RMPG_BOOTSTORE_MOUNT_POINT")"; then
        RMPG_BOOTSTORE_KIND="${_found%% *}"
        RMPG_BOOTSTORE_DIR="${_found#* }"
        RMPG_BOOTSTORE_MP="$RMPG_BOOTSTORE_MOUNT_POINT"
        RMPG_BOOTSTORE_DEV="$(awk -v mp="$RMPG_BOOTSTORE_MOUNT_POINT" '$2 == mp { print $1; exit }' /proc/mounts 2>/dev/null)"
        rmpg_bootstore_log "already mounted kind=$RMPG_BOOTSTORE_KIND dir=$RMPG_BOOTSTORE_DIR"
        return 0
    fi

    _tried=0
    for _cand in $(_rmpg_bs_candidates); do
        _tried=$((_tried + 1))
        if _rmpg_bs_try "$_cand"; then
            rmpg_bootstore_log "found kind=$RMPG_BOOTSTORE_KIND dev=$RMPG_BOOTSTORE_DEV dir=$RMPG_BOOTSTORE_DIR"
            return 0
        fi
    done

    rmpg_bootstore_log "NOT_FOUND (probed $_tried device(s) from $_rmpg_bs_procparts)"
    return 1
}

rmpg_bootstore_rw() {
    [ -n "$RMPG_BOOTSTORE_MP" ] || return 1
    if $_rmpg_bs_mount -o remount,rw "$RMPG_BOOTSTORE_MP" 2>/dev/null; then
        RMPG_BOOTSTORE_RO=0
        return 0
    fi
    # The common real-world cause on the no-USB path: Windows Fast Startup or
    # hibernation left the NTFS volume with a dirty log, and ntfs3 refuses to
    # mount it writable rather than risk the Windows install. Name it, because
    # the fix is a Windows-side full shutdown and nothing on this terminal can
    # do it.
    if [ "$RMPG_BOOTSTORE_KIND" = "grubntfs" ]; then
        rmpg_bootstore_log "READONLY (ntfs3 refused a writable remount — the Windows volume is probably dirty from Fast Startup or hibernation; a full Windows shutdown clears it)"
    else
        rmpg_bootstore_log "READONLY (could not remount $RMPG_BOOTSTORE_MP read-write)"
    fi
    RMPG_BOOTSTORE_RO=1
    return 1
}

rmpg_bootstore_ro() {
    [ -n "$RMPG_BOOTSTORE_MP" ] || return 1
    sync
    $_rmpg_bs_mount -o remount,ro "$RMPG_BOOTSTORE_MP" 2>/dev/null && RMPG_BOOTSTORE_RO=1
    return 0
}

# ── Slot pointer ─────────────────────────────────────────────────────────────
# Two bootloaders, two file formats, one interface. Both are plain text the
# running system can rewrite; neither needs bootloader tooling on the target
# (which is why the GRUB path uses a sourced slot.cfg rather than grubenv —
# grub-editenv is not in this image).

_rmpg_bs_slotfile() {
    case "$RMPG_BOOTSTORE_KIND" in
        extlinux) echo "$RMPG_BOOTSTORE_DIR/extlinux.conf" ;;
        grubntfs) echo "$RMPG_BOOTSTORE_DIR/slot.cfg" ;;
        *) return 1 ;;
    esac
}

rmpg_bootstore_get_slot() {
    _f="$(_rmpg_bs_slotfile)" || return 1
    [ -f "$_f" ] || return 1
    case "$RMPG_BOOTSTORE_KIND" in
        extlinux) awk '/^DEFAULT /{ print $2; exit }' "$_f" ;;
        grubntfs) sed -n 's/^[[:space:]]*set[[:space:]]\{1,\}rmpg_slot=\([A-Za-z_]*\).*/\1/p' "$_f" | head -1 ;;
    esac
}

rmpg_bootstore_other_slot() {
    if [ "$(rmpg_bootstore_get_slot)" = "slot_b" ]; then echo "slot_a"; else echo "slot_b"; fi
}

# Writes are staged to a temp file and renamed, so a power loss mid-write
# cannot leave a half-written pointer that neither bootloader can parse — the
# one failure this whole subsystem must never cause. A vehicle terminal loses
# power without warning as a matter of routine.
rmpg_bootstore_set_slot() {
    _slot="$1"
    case "$_slot" in
        slot_a|slot_b) : ;;
        *) rmpg_bootstore_log "refusing to set an unknown slot: $_slot"; return 1 ;;
    esac

    _f="$(_rmpg_bs_slotfile)" || return 1
    _tmp="$_f.new"

    case "$RMPG_BOOTSTORE_KIND" in
        extlinux)
            [ -f "$_f" ] || { rmpg_bootstore_log "missing $_f"; return 1; }
            sed "s/^DEFAULT .*/DEFAULT $_slot/" "$_f" > "$_tmp" || return 1
            ;;
        grubntfs)
            # Generated whole rather than edited: on this path the file may not
            # exist yet (an install predating A/B), and a fixed two-line file is
            # simpler to reason about than a patch against unknown content.
            {
                echo "# Written by rmpg-update on the terminal. GRUB sources this file."
                echo "set rmpg_slot=$_slot"
            } > "$_tmp" || return 1
            ;;
    esac

    # Same-directory rename is atomic on ext2 and on ntfs3.
    if mv "$_tmp" "$_f"; then
        sync
        rmpg_bootstore_log "slot pointer set to $_slot in $_f"
        return 0
    fi
    rm -f "$_tmp" 2>/dev/null || true
    rmpg_bootstore_log "FAILED to write the slot pointer to $_f"
    return 1
}
