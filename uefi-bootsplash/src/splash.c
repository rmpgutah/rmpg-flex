// uefi-bootsplash/src/splash.c
#include "splash.h"

// RMPG Blue & Silver theme, converted from client/src/styles/theme-palettes.css:
// --surface-base #0c1a2b (background), --brand-gold #b7c2cf (silver wordmark, in
// this theme "gold" is actually a metallic silver-blue per CLAUDE.md's Design
// tokens section — same values used here for consistency with the rest of the app).
#define BG_R 0x0c
#define BG_G 0x1a
#define BG_B 0x2b
#define FG_R 0xb7
#define FG_G 0xc2
#define FG_B 0xcf

static VOID
FillScreen(EFI_GRAPHICS_OUTPUT_PROTOCOL *Gop, UINT8 R, UINT8 G, UINT8 B)
{
  EFI_GRAPHICS_OUTPUT_BLT_PIXEL Pixel;
  Pixel.Red = R;
  Pixel.Green = G;
  Pixel.Blue = B;
  Pixel.Reserved = 0;

  Gop->Blt(Gop, &Pixel, EfiBltVideoFill, 0, 0, 0, 0,
           Gop->Mode->Info->HorizontalResolution,
           Gop->Mode->Info->VerticalResolution, 0);
}

// Draws a simple filled rectangle "wordmark" placeholder centered on screen —
// a real glyph-based renderer is a larger undertaking than this task's scope
// (a static screen, not a font engine); a solid brand-colored bar centered on
// the dark background reads clearly as a boot splash without needing a font
// table. If richer text rendering is wanted later, this is the function to
// extend.
static VOID
DrawWordmarkPlaceholder(EFI_GRAPHICS_OUTPUT_PROTOCOL *Gop)
{
  UINT32 ScreenW = Gop->Mode->Info->HorizontalResolution;
  UINT32 ScreenH = Gop->Mode->Info->VerticalResolution;
  UINT32 BarW = ScreenW / 3;
  UINT32 BarH = ScreenH / 12;
  UINT32 X = (ScreenW - BarW) / 2;
  UINT32 Y = (ScreenH - BarH) / 2;

  EFI_GRAPHICS_OUTPUT_BLT_PIXEL Pixel;
  Pixel.Red = FG_R;
  Pixel.Green = FG_G;
  Pixel.Blue = FG_B;
  Pixel.Reserved = 0;

  Gop->Blt(Gop, &Pixel, EfiBltVideoFill, 0, 0, X, Y, BarW, BarH, 0);
}

VOID
ShowBootSplash(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable)
{
  (VOID)ImageHandle;
  EFI_STATUS Status;
  EFI_GRAPHICS_OUTPUT_PROTOCOL *Gop = NULL;
  EFI_GUID GopGuid = EFI_GRAPHICS_OUTPUT_PROTOCOL_GUID;

  Status = SystemTable->BootServices->LocateProtocol(&GopGuid, NULL, (VOID **)&Gop);

  // Text-mode fallback covers both "GOP unavailable" (LocateProtocol failed)
  // and "GOP present but its Mode/Info isn't populated yet" — some firmware
  // returns a GOP handle before its mode info is fully set up. Either way
  // ShowBootSplash must never fail, so both cases fall through to Print().
  if (EFI_ERROR(Status) || Gop == NULL || Gop->Mode == NULL || Gop->Mode->Info == NULL) {
    // Text-mode fallback — GOP unavailable. Never treat this as a failure.
    Print(L"RMPG Flex\r\n");
  } else {
    FillScreen(Gop, BG_R, BG_G, BG_B);
    DrawWordmarkPlaceholder(Gop);
  }

  SystemTable->BootServices->Stall(SPLASH_DURATION_SECONDS * 1000 * 1000);
}
