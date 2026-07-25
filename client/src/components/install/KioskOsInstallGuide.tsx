// Full field-install dossier for the Kiosk Linux OS image on a Panasonic
// Toughbook FZ-55 — the designated kiosk terminal hardware.
//
// The release tarball (kiosk-linux-os-1.2.0+) ships THREE artifacts:
//   disk.img        — flashable A/B-slot disk image (bootloader included);
//                     this is what field installs use.
//   bzImage         — bare kernel  (QEMU / development use)
//   rootfs.cpio.gz  — bare initramfs (QEMU / development use)
import { Bullets, Callout, Cmd, GuideFrame, GuideHeading, Screenshots, Step, Troubleshooting } from './InstallGuideParts';

// Real captures from the running OS under the QEMU reference environment —
// not mockups. Regenerate with kiosk-linux/test/run-qemu-browser.sh and copy
// the resulting PNG into client/public/kiosk-os/.
const SHOTS = [
  {
    src: '/kiosk-os/kiosk-console.png',
    caption: 'Boot straight into the RMPG Flex console — fullscreen, no desktop, no exposed OS. The status panel confirms the terminal is online and authenticated against the live system.',
  },
];

export default function KioskOsInstallGuide() {
  return (
    <GuideFrame
      title="Kiosk Terminal Install — Panasonic Toughbook FZ-55"
      intro="Turns an FZ-55 into a dedicated RMPG Flex kiosk terminal. The device boots straight into the Flex console fullscreen — no Windows, no desktop, no user-serviceable OS surface. The image carries dual A/B boot slots, so a failed boot automatically falls back to the last known-good copy."
    >
      <GuideHeading>What it looks like</GuideHeading>
      <Screenshots shots={SHOTS} />

      <GuideHeading>What you need</GuideHeading>
      <Bullets
        items={[
          <>Panasonic Toughbook FZ-55 (Mk1 or Mk2) with AC power connected</>,
          <>A USB flash drive, 4 GB or larger — <strong>all contents will be erased</strong></>,
          <>Any Windows, macOS, or Linux computer to write the USB drive</>,
          <>The Kiosk Linux OS <code>.zip</code> from the download card above</>,
          <><strong>A wired ethernet drop at the kiosk's location.</strong> The currently published image is wired-only — it has no Wi-Fi stack, so it cannot come online over Wi-Fi. Wi-Fi support is built and is shipping in the next release; if your site has no ethernet, wait for that rather than flashing this one.</>,
        ]}
      />

      <GuideHeading>Procedure</GuideHeading>
      <div className="space-y-0">
        <Step n={1} title="Extract the image">
          The download is a <code>.zip</code> containing a single file, <code>disk.img</code> — the
          complete bootable image, bootloader and both recovery slots included.
          <br />
          <strong style={{ color: 'var(--rmpg-300)' }}>Windows —</strong> right-click the downloaded
          file → <strong>Extract All…</strong> → <strong>Extract</strong>. No extra software needed.
          <br />
          <strong style={{ color: 'var(--rmpg-300)' }}>macOS —</strong> double-click it.
          <br />
          <strong style={{ color: 'var(--rmpg-300)' }}>Linux —</strong> <code>unzip
          kiosk-linux-os-1.2.0.zip</code>, or use the <code>.tar.gz</code> in the same bucket.
          <br />
          The download is about 236 MB and expands to a 512 MB image, so allow roughly 1 GB of free
          space.
        </Step>

        <Step n={2} title="Write disk.img to the USB drive">
          <strong style={{ color: 'var(--rmpg-300)' }}>Windows (recommended path) —</strong> download{' '}
          <a href="https://rufus.ie" target="_blank" rel="noreferrer" style={{ color: '#d4a017' }}>Rufus</a>{' '}
          (a single portable .exe, no install). Run it, then: <strong>Device</strong> → your USB drive
          → <strong>SELECT</strong> → change the file-type dropdown in the bottom-right of the file
          picker from "Disk or ISO image" to <strong>All files (*.*)</strong> so <code>disk.img</code>{' '}
          becomes visible → pick it → keep <strong>DD Image</strong> mode if prompted →{' '}
          <strong>START</strong> → confirm the erase warning. Takes a few minutes.
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
          {
            symptom: 'Windows: "How do you want to open this file?" or the download will not open',
            fix: <>Make sure you downloaded the <code>.zip</code> from the button above, not a <code>.tar.gz</code> — Windows cannot open a .tar.gz by double-clicking. Right-click the .zip → <strong>Extract All…</strong></>,
          },
          {
            symptom: 'Rufus does not list disk.img in the file picker',
            fix: <>Its file filter defaults to disk images and ISOs only. Change the dropdown in the bottom-right corner of the picker to <strong>All files (*.*)</strong>.</>,
          },
          {
            symptom: 'Browser warns the download is uncommon or blocks it',
            fix: <>Choose Keep / Download anyway. The file is unsigned because it is an internal OS image rather than commercial software; verify you started the download from rmpgutah.us.</>,
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
