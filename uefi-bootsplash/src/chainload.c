// uefi-bootsplash/src/chainload.c
#include "chainload.h"

EFI_STATUS
Chainload(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable, CHAR16 *TargetPath)
{
  EFI_STATUS Status;
  EFI_LOADED_IMAGE_PROTOCOL *LoadedImage = NULL;
  EFI_GUID LoadedImageGuid = EFI_LOADED_IMAGE_PROTOCOL_GUID;
  EFI_HANDLE TargetHandle = NULL;

  Status = SystemTable->BootServices->HandleProtocol(
      ImageHandle, &LoadedImageGuid, (VOID **)&LoadedImage);
  if (EFI_ERROR(Status)) {
    Print(L"Chainload failed: could not get LoadedImageProtocol for self (status %r)\r\n", Status);
    return Status;
  }

  // Build a device path for TargetPath on the SAME device handle this app
  // was itself loaded from (LoadedImage->DeviceHandle) — this is what
  // ensures we chainload the Windows Boot Manager on the same ESP, not go
  // searching across every device in the system. FileDevicePath comes from
  // gnu-efi's lib/dpath.c, which build-gnuefi-pe.sh already compiles into
  // libefi.a (see LIB_FILES in that script) — no rebuild was needed for it.
  EFI_DEVICE_PATH *TargetDevicePath = FileDevicePath(LoadedImage->DeviceHandle, TargetPath);
  if (TargetDevicePath == NULL) {
    Print(L"Chainload failed: could not build device path for %s\r\n", TargetPath);
    return EFI_NOT_FOUND;
  }

  Status = SystemTable->BootServices->LoadImage(
      FALSE, ImageHandle, TargetDevicePath, NULL, 0, &TargetHandle);
  FreePool(TargetDevicePath);

  if (EFI_ERROR(Status)) {
    Print(L"Could not find Windows Boot Manager at %s (status %r)\r\n", TargetPath, Status);
    return Status;
  }

  Print(L"Chainloading %s ...\r\n", TargetPath);
  Status = SystemTable->BootServices->StartImage(TargetHandle, NULL, NULL);

  // StartImage only returns if the started image itself returns control
  // (e.g. Windows Boot Manager encountered its own error and returned) —
  // a normal successful boot hand-off never reaches this line.
  Print(L"Windows Boot Manager returned control unexpectedly (status %r)\r\n", Status);
  return Status;
}
