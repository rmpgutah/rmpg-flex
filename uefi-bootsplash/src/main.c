// uefi-bootsplash/src/main.c
//
// Task 1 built the toolchain scaffold here (a bare Print-and-stall, just to
// prove the build + QEMU/OVMF harness worked end-to-end). Task 2 wires in the
// real GOP-based splash (src/splash.c); Task 3 will extend this further with
// the chainload step that runs immediately after ShowBootSplash returns.
#include <efi.h>
#include <efilib.h>
#include "splash.h"

EFI_STATUS
EFIAPI
efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)
{
  InitializeLib(ImageHandle, SystemTable);

  ShowBootSplash(ImageHandle, SystemTable);

  return EFI_SUCCESS;
}
