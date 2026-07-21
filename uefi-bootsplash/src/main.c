// uefi-bootsplash/src/main.c
//
// Task 1 built the toolchain scaffold here (a bare Print-and-stall, just to
// prove the build + QEMU/OVMF harness worked end-to-end). Task 2 wired in the
// real GOP-based splash (src/splash.c). Task 3 adds the chainload step that
// runs immediately after ShowBootSplash returns, handing off to the Windows
// Boot Manager on success, or halting visibly on failure.
#include <efi.h>
#include <efilib.h>
#include "splash.h"
#include "chainload.h"

EFI_STATUS
EFIAPI
efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)
{
  InitializeLib(ImageHandle, SystemTable);

  ShowBootSplash(ImageHandle, SystemTable);

  Chainload(ImageHandle, SystemTable, WINDOWS_BOOT_MANAGER_PATH);

  // Only reached if Chainload failed and returned (a successful chainload
  // hands off control permanently and never comes back here). Halt visibly
  // rather than silently returning to the firmware boot menu or rebooting —
  // per this project's Global Constraint that every failure path is visible
  // and does not loop unboundedly without a trace.
  Print(L"\r\nBoot splash halted after chainload failure. Power off or check firmware boot settings.\r\n");
  for (;;) {
    SystemTable->BootServices->Stall(60 * 1000 * 1000); // 60s, repeated forever
  }
}
