#!/usr/bin/env python3
"""Static checks for the Windows installer PowerShell scripts.

No PowerShell interpreter exists on the macOS/Linux hosts this project is
developed on, so these scripts have no syntax gate at all — they are edited
here and first executed on a customer machine, as Administrator, where they
modify the boot configuration. That is the worst possible place to discover a
quoting mistake.

These checks cover the specific, silent failure modes this file is prone to,
all of which produce a script that RUNS and reports success while writing a
broken bootloader config:

1. Here-string pairing. `@"` must close with a line that is exactly `"@`, and
   `@'` with exactly `'@`. Opening with one and closing with the other was a
   real mistake made on 2026-07-25.

2. Backslash escapes. PowerShell escapes with a BACKTICK, not a backslash. In
   an expandable here-string, `\\$rmpg_slot` emits a literal backslash AND
   expands the variable to nothing. Also made on 2026-07-25.

3. GRUB variables inside an expandable here-string. `$rmpgroot` and
   `$rmpg_slot` are GRUB variables that must reach grub.cfg verbatim. Inside
   `@" "@` PowerShell expands them to empty strings, and the resulting
   grub.cfg boots nothing — from source that reads perfectly.

Usage: kiosk-linux/test/lint-installer.py
Exit 0 = clean.
"""

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
INSTALLER_DIR = HERE.parent / "installer-windows"

# GRUB variables that must survive into the generated config as literal text.
GRUB_VARS = ("$rmpgroot", "$rmpg_slot")

problems: list[str] = []


def check(path: Path) -> None:
    lines = path.read_text().splitlines()
    # None when outside a here-string, else '"' or "'" for the opening kind.
    kind = None
    open_line = 0

    for n, line in enumerate(lines, start=1):
        stripped = line.strip()

        if kind is None:
            # An opener is `@"` or `@'` at the END of a line (anything after it
            # on the same line is not part of the string).
            if re.search(r"@\"\s*$", line):
                kind, open_line = '"', n
            elif re.search(r"@'\s*$", line):
                kind, open_line = "'", n
            continue

        # Inside a here-string. The terminator must begin at column 0, but
        # PowerShell DOES allow the expression to continue after it — e.g.
        #     Write-Host @"
        #     ...
        #     "@ -ForegroundColor White
        # is valid and this file uses that form. An earlier version of this
        # check required the line to be exactly `"@`, so it missed those
        # terminators, believed it was still inside a string for the next 160
        # lines, and reported a dozen confident false positives.
        if line.startswith('"@') or line.startswith("'@"):
            actual = line[:2]
            expected = f'{kind}@'
            if actual != expected:
                problems.append(
                    f"{path.name}:{n}: here-string opened at line {open_line} with @{kind} "
                    f"is closed with {actual}, expected {expected}"
                )
            kind = None
            continue

        # An indented terminator is a genuine hazard: PowerShell does not
        # recognise it, so the string swallows the rest of the script.
        if stripped in ('"@', "'@"):
            problems.append(
                f"{path.name}:{n}: here-string terminator {stripped} is indented; "
                f"PowerShell only recognises it at the start of a line, so the "
                f"string opened at line {open_line} would swallow the rest of the file"
            )
            continue

        if "\\$" in line:
            problems.append(
                f"{path.name}:{n}: backslash-dollar found inside a here-string. "
                f"PowerShell escapes with a backtick, not a backslash — "
                f"this emits a literal backslash and still expands the variable."
            )

        if kind == '"':
            for var in GRUB_VARS:
                if var in line:
                    problems.append(
                        f"{path.name}:{n}: GRUB variable {var} sits inside an EXPANDABLE "
                        f"here-string (opened at line {open_line}). PowerShell will expand it "
                        f"to an empty string. Use a verbatim here-string (@' '@)."
                    )

    if kind is not None:
        problems.append(
            f"{path.name}: here-string opened at line {open_line} with @{kind} is never closed"
        )


def main() -> int:
    scripts = sorted(INSTALLER_DIR.glob("*.ps1"))
    if not scripts:
        print(f"FAIL: no .ps1 files found under {INSTALLER_DIR}", file=sys.stderr)
        return 1

    for script in scripts:
        check(script)

    if problems:
        print("PowerShell installer lint FAILED:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1

    names = ", ".join(s.name for s in scripts)
    print(f"PASS: installer lint clean ({names})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
