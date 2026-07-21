// uefi-bootsplash/test/dummy-bootmgr/dummy_bootmgr.c
//
// Test-only stand-in for \EFI\Microsoft\Boot\bootmgfw.efi. There is no real
// Windows install available in this dev environment, so this trivial app
// (reusing Task 1's minimal efi_main shape) stands in as the chainload
// target: if Chainload() in src/chainload.c genuinely finds and starts it,
// this prints a distinctive marker that a real Windows Boot Manager would
// never print, proving the LoadImage/StartImage hand-off actually worked.
#include <efi.h>
#include <efilib.h>

EFI_STATUS
EFIAPI
efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)
{
  InitializeLib(ImageHandle, SystemTable);
  Print(L"DUMMY WINDOWS BOOT MANAGER REACHED\r\n");
  SystemTable->BootServices->Stall(3 * 1000 * 1000);
  return EFI_SUCCESS;
}
