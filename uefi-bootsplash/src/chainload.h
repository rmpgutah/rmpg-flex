// uefi-bootsplash/src/chainload.h
#ifndef RMPG_CHAINLOAD_H
#define RMPG_CHAINLOAD_H

#include <efi.h>
#include <efilib.h>

// The well-known path Windows installs its own UEFI boot manager to, on the
// same EFI System Partition. Not a heuristic search — a fixed path, per this
// project's scope decision (single Windows install, no multi-OS detection).
#define WINDOWS_BOOT_MANAGER_PATH L"\\EFI\\Microsoft\\Boot\\bootmgfw.efi"

// Locates TargetPath on the same device this app itself was loaded from, and
// hands off execution to it via LoadImage/StartImage. On success, this
// function does not return (control passes to TargetPath). On failure,
// prints a specific error message to the UEFI console and returns an error
// status — the caller (main.c) is responsible for halting, never retrying
// or rebooting.
EFI_STATUS Chainload(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable, CHAR16 *TargetPath);

#endif
