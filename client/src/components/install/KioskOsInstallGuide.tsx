// Full field-install dossier for the Kiosk Linux OS image on a Panasonic
// Toughbook FZ-55 — the designated kiosk terminal hardware.
//
// The release tarball (kiosk-linux-os-1.2.0+) ships THREE artifacts:
//   disk.img        — flashable A/B-slot disk image (bootloader included);
//                     this is what field installs use.
//   bzImage         — bare kernel  (QEMU / development use)
//   rootfs.cpio.gz  — bare initramfs (QEMU / development use)
import { Bullets, Callout, Cmd, GuideFrame, GuideHeading, Step, Troubleshooting } from './InstallGuideParts';

export default function KioskOsInstallGuide() {
  return (
    <GuideFrame
      title="Kiosk Terminal Install — Panasonic Toughbook FZ-55"
      intro="Turns an FZ-55 into a dedicated RMPG Flex kiosk terminal. The device boots straight into the Flex console fullscreen — no Windows, no desktop, no user-serviceable OS surface. The image carries dual A/B boot slots, so a failed boot automatically falls back to the last known-good copy."
    >
      <GuideHeading>What you need</GuideHeading>
      <Bullets
        items={[
          <>Panasonic Toughbook FZ-55 (Mk1 or Mk2) with AC power connected</>,
          <>A USB flash drive, 4 GB or larger — <strong>all contents will be erased</strong></>,
          <>Any Windows, macOS, or Linux computer to write the USB drive</>,
          <>The Kiosk Linux OS <code>.tar.gz</code> from the download card above</>,
          <>A wired ethernet drop at the kiosk's location — this image has no Wi-Fi stack</>,
        ]}
      />

      <GuideHeading>Procedure</GuideHeading>
      <div className="space-y-0">
        <Step n={1} title="Extract the image">
          Unpack the downloaded archive. The file you need for a hardware install is <code>disk.img</code>:
          <Cmd>{'tar xzf kiosk-linux-os-1.2.0.tar.gz'}</Cmd>
          The <code>bzImage</code> and <code>rootfs.cpio.gz</code> files in the same archive are for
          QEMU/development use — ignore them for a Toughbook install.
        </Step>

        <Step n={2} title="Write disk.img to the USB drive">
          <strong style={{ color: 'var(--rmpg-300)' }}>Windows —</strong> use{' '}
          <a href="https://rufus.ie" target="_blank" rel="noreferrer" style={{ color: '#d4a017' }}>Rufus</a>:
          select the USB drive, click SELECT, change the file-type filter to <em>All files</em> so
          <code> disk.img</code> is visible, pick it, keep <strong>DD Image</strong> mode when prompted,
          then START.
          <br />
          <strong style={{ color: 'var(--rmpg-300)' }}>macOS —</strong> find the disk number with{' '}
          <code>diskutil list</code> (match it by size), then:
          <Cmd>{'diskutil unmountDisk /dev/diskN\nsudo dd if=disk.img of=/dev/rdiskN bs=4m status=progress'}</Cmd>
          <strong style={{ color: 'var(--rmpg-300)' }}>Linux —</strong> find the device with{' '}
          <code>lsblk</code>, then:
          <Cmd>{'sudo dd if=disk.img of=/dev/sdX bs=4M status=progress conv=fsync'}</Cmd>
          Double-check the device name before pressing Return — <code>dd</code> overwrites whatever it is
          pointed at, including your own system disk.
        </Step>

        <Step n={3} title="Configure the FZ-55 firmware">
          Insert the USB drive into the Toughbook. Power on and tap <strong>F2</strong> repeatedly at the
          Panasonic splash screen to enter Setup, then set:
          <ul className="mt-1 space-y-1">
            <li>• <strong>Security → Secure Boot</strong>: <em>Disabled</em> (the kiosk bootloader is unsigned syslinux)</li>
            <li>• <strong>Boot → UEFI Boot</strong>: <em>Disabled</em>, or select <em>Legacy (CSM)</em> boot mode</li>
            <li>• <strong>Boot → USB Boot</strong>: <em>Enabled</em></li>
          </ul>
          Press <strong>F10</strong> to save and exit.
        </Step>

        <Step n={4} title="Boot the kiosk">
          As the machine restarts, tap <strong>Esc</strong> (or <strong>F12</strong> on some firmware
          revisions) to open the one-time Boot Menu and select the USB drive. Kernel boot text scrolls for
          a few seconds, then the RMPG Flex console loads fullscreen over the wired connection. Nothing
          else needs configuring — the kiosk points at rmpgutah.us on its own.
        </Step>

        <Step n={5} title="Optional — install to the internal drive">
          Running from USB is fully supported for a kiosk. To make it permanent on the internal SSD, boot
          from the stick, switch to the console shell (user <code>root</code>, no password), identify the
          internal drive with <code>cat /proc/partitions</code> (NVMe appears as <code>nvme0n1</code>,
          SATA as <code>sda</code>), clone the running stick onto it, then remove the USB drive and boot
          from the internal disk with the same firmware settings.
        </Step>
      </div>

      <GuideHeading>How the A/B slots protect the kiosk</GuideHeading>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--rmpg-400)' }}>
        The disk carries two identical OS slots (<code>slot_a</code> / <code>slot_b</code>). Every boot
        increments an attempt counter that is cleared only once the kiosk reaches a verified-healthy state
        — browser up and serving. Three consecutive failed boots automatically flip the default to the
        other slot and reboot, so a bad future update cannot brick a fielded terminal.
      </p>

      <GuideHeading>What is in this image</GuideHeading>
      <Bullets
        items={[
          <>A minimal Linux kernel and root filesystem — no desktop environment, no shell exposed to the user, no other applications</>,
          <>Hardware support for the FZ-55: Intel UHD 620 graphics, Intel gigabit ethernet, NVMe and SATA storage, USB boot, and HID/touchscreen input</>,
          <>A fullscreen WPE WebKit browser pinned to the RMPG Flex console over HTTPS</>,
          <>Automatic DHCP networking on the wired interface at boot</>,
        ]}
      />

      <GuideHeading>Troubleshooting</GuideHeading>
      <Troubleshooting
        items={[
          {
            symptom: 'Black screen after the boot text',
            fix: <>Confirm Legacy/CSM boot is selected in firmware — UEFI-only mode will not start this image.</>,
          },
          {
            symptom: '"Operating System not found"',
            fix: <>The USB write did not complete, or the wrong device was written. Redo Step 2 and verify the drive letter/number carefully.</>,
          },
          {
            symptom: 'Console loads but shows a connection error',
            fix: <>Check the wired ethernet drop. The kiosk needs to reach rmpgutah.us over HTTPS (TCP 443); there is no Wi-Fi fallback.</>,
          },
          {
            symptom: 'Firmware has no Legacy/CSM option',
            fix: <>Some late FZ-55 firmware revisions removed CSM. Contact IT before flashing — a UEFI-native image build is planned.</>,
          },
          {
            symptom: 'Terminal boots to the old image after an update',
            fix: <>The A/B fallback rolled back after three failed boots — the previous slot is intentionally still serving. Report it rather than re-flashing; the failure is worth capturing.</>,
          },
        ]}
      />

      <GuideHeading>Trying it without hardware</GuideHeading>
      <p className="text-xs leading-relaxed mb-1" style={{ color: 'var(--rmpg-400)' }}>
        The same <code>disk.img</code> boots under QEMU on any x86_64 workstation — useful for evaluating
        the kiosk build before flashing a Toughbook:
      </p>
      <Cmd>{'qemu-system-x86_64 -drive file=disk.img,if=virtio,format=raw \\\n  -m 1024 -vga none -device virtio-gpu-pci \\\n  -netdev user,id=net0 -device virtio-net-pci,netdev=net0'}</Cmd>

      <Callout label="Validation status">
        This release includes FZ-55 hardware enablement (Intel UHD 620 graphics, Intel gigabit ethernet,
        NVMe/SATA storage, USB boot, HID/touch input) and is verified end-to-end under the QEMU reference
        environment. First-article validation on physical FZ-55 hardware is still pending — flash and
        confirm one unit before any fleet-wide rollout.
      </Callout>
    </GuideFrame>
  );
}
