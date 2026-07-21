// uefi-bootsplash/src/splash.h
#ifndef RMPG_SPLASH_H
#define RMPG_SPLASH_H

#include <efi.h>
#include <efilib.h>

// Draws the RMPG Blue & Silver boot splash (or falls back to a text-mode
// message if the Graphics Output Protocol isn't available), then waits
// SPLASH_DURATION_SECONDS before returning. Never fails — a missing GOP
// degrades to text, it never blocks progress to the chainload step.
VOID ShowBootSplash(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable);

#define SPLASH_DURATION_SECONDS 3

#endif
