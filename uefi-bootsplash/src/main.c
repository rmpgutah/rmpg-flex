// uefi-bootsplash/src/main.c
//
// Task 1 (toolchain scaffold): minimal gnu-efi entry point used only to prove
// the build + QEMU/OVMF harness work end-to-end. Replaced/extended in Task 3
// with the real splash/chainload logic.
#include <efi.h>
#include <efilib.h>

EFI_STATUS
EFIAPI
efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)
{
  InitializeLib(ImageHandle, SystemTable);
  Print(L"RMPG Flex boot splash - toolchain check OK\r\n");
  BS->Stall(3 * 1000 * 1000); // 3 seconds, microseconds
  return EFI_SUCCESS;
}
