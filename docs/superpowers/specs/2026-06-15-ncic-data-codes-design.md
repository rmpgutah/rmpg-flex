# NCIC/NLETS Data Codes — Design

**Date:** 2026-06-15
**Status:** Approved design → implementation plan
**Surface:** NCIC / NLETS Terminal (`/ncic`), client-only

## Problem

The NCIC terminal (`NcicQueryPanel` + `ncicFormatter.ts`) already renders authentic
NCIC **field mnemonics** (`NAM/`, `RAC/`, `VMA/`, `VCO/`, `OLN/`, `OLS/`) but emits the
**raw database label** next to each — e.g. `RAC/White`, `VMA/Toyota`, `VCO/Blue`,
`VST/Sedan (4-Door)`. A real NCIC/NLETS return uses standardized **coded values**:
`RAC/W`, `VMA/TOYT`, `VCO/BLU`, `VST/4D`. The system has no translation layer between
the stored human-readable values and authoritative NCIC/Utah codes.

Goal: advance the terminal so it speaks real NCIC/NLETS + Utah data codes, on both
output (rendering) and input (operator queries), without losing readability.

## Decisions (from brainstorming)

- **Display format:** code **plus** decoded label — `RAC/W (WHITE)`, `VMA/TOYT (TOYOTA)`.
- **Domains:** person descriptors, vehicle codes, geographic/agency (state + Utah DL),
  and a curated offense/charge table.
- **Input:** code-aware — a code decoder command + code-tolerant query parsing.
- **Offense table depth:** curated common set (~40–60 offenses), each with Utah Code §
  + NCIC offense category + severity class; extensible; explicitly **not** the full
  ~1,000-entry NCIC offense manual.
- **Hispanic handling:** accurate — Hispanic is an **ethnicity**, not an NCIC race.
  Render `RAC/U (UNKNOWN)` on the race line plus a separate `ETN/H (HISPANIC)` line.

## Architecture

Chosen approach: **single code-table module + thin pure translate layer** (mirrors the
existing `lawEnforcementEnums.ts` single-source-of-truth pattern). Rejected: inlining
maps into the formatter (bloats a 1,222-line file, unusable by the input parser, hard
to test) and server-side translation (couples display to the API, can't help input
encoding, breaks plain-label consumers).

Everything is **client-only**: no D1 migration, no server changes. The server vehicle
query (`src/routes/records.ts:1536`) already `LIKE`-matches `make`/`model`, so an input
make-code (`TOYT`→Toyota) is expanded client-side before the existing search runs.

### Unit 1 — `client/src/constants/ncicCodes.ts` (new)

Authoritative bidirectional code tables + pure helpers. Each domain is a
`Record<canonicalLabel, code>`; a reverse `code → label` index is built once at module
load. The module never throws — unknown values fall back to the raw value uppercased.

Domains:

- **Person**
  - `RACE` — NCIC `W` White, `B` Black, `I` American Indian/Alaska Native,
    `A` Asian/Pacific Islander, `U` Unknown. (Hispanic is NOT here — see ethnicity.)
  - `ETHNICITY` — `H` Hispanic, `N` Not Hispanic, `U` Unknown. Only emitted when the
    stored race/ethnicity indicates Hispanic.
  - `SEX` — `M` `F` `U`; `X` accepted for non-binary/other (modern addition, documented).
  - `EYE` — `BLU BRO GRN HAZ GRY BLK MAR PNK MUL XXX` (NCIC eye-color set).
  - `HAIR` — `BLK BRO BLN RED GRY WHI BAL SDY ONG PLE XXX` (NCIC hair-color set).
  - `normalizeHeight(value)` → NCIC 3-digit feet-inches (e.g. `5'10"`/`510`/`70in` → `510`).
  - `normalizeWeight(value)` → NCIC 3-digit pounds.
- **Vehicle**
  - `VMA` — NCIC vehicle make codes (~90 common makes: TOYT FORD CHEV HOND NISS DODG
    GMC JEEP HYUN KIA SUBA VOLK BMW MERZ AUDI LEXS ACUR INFI MAZD CADI BUIC CHRY RAM
    TESL VOLV MITS etc.).
  - `VCO` — NCIC vehicle color codes (BLK BLU RED WHI GRY SIL GRN TAN BRO MAR GLD ORG
    PNK PLE YEL BGE BRZ CPR CRM LAV TEL TRQ MUL etc.).
  - `VST` — NCIC body-style codes (`4D` 4-door sedan, `2D` 2-door, `CP` coupe,
    `CV` convertible, `SW` station wagon, `HB` hatchback, `UT` SUV/utility, `PK` pickup,
    `VN` van, `MC` motorcycle, `BU` bus, `TR` trailer, etc.).
- **Geographic / agency**
  - `STATE` — all 50 + DC + PR/GU/VI/AS/MP territories + common Canadian provinces
    (for NLETS) — two-letter codes = labels.
  - `DL_CLASS` — Utah DLD: `A`/`B`/`C` commercial (CDL), `D` standard passenger,
    `M` motorcycle.
  - `DL_RESTRICTION` — Utah restriction codes (corrective lenses, etc.).
  - `DL_ENDORSEMENT` — Utah endorsement codes (H/N/P/S/T/X).
- **Offense (curated)**
  - `OFFENSE` — `Record<canonicalOffenseLabel, { utahStatute, ncicCategory, severity }>`
    for ~40–60 common offenses. Severity uses Utah classes (F1/F2/F3, MA/MB/MC,
    infraction). Documented as a curated, extensible subset.

Helpers (all pure, exported):
- `encode(domain, label): string` — label → code (else uppercased input).
- `decode(domain, code): string` — code → label (else uppercased input).
- `fmtCoded(domain, value): string` — `"W (WHITE)"`; returns `''` for empty input so
  the formatter can omit the field cleanly.
- `lookupAnyCode(term): { domain, code, label }[]` — searches all tables both ways;
  powers the `QZ` decoder command.

### Unit 2 — `ncicFormatter.ts` (modify)

Replace raw value rendering with coded rendering across the formatters that emit
descriptor/vehicle/DL fields:
- `formatPersonResponse`, person section of `formatCrossReferenceResponse`,
  `formatDlResponse`, `formatArrestResponse`: `SEX/`, `RAC/` (+ `ETN/` when Hispanic),
  `EYE/`, `HAI/`, `HGT/`, `WGT/`, `CLS/` via the helpers.
- `formatVehicleResponse` + vehicle-derived lines: `VMA/`, `VCO/`, `VST/`.
- `OLS/` / `LIS/` state fields via `STATE`.
- Offense lines (`CHG/`, criminal-history `OFL/`): when a charge label matches the
  `OFFENSE` table, append `(<UtahStatute> · <severity>)`.

No change to `getNcicLineClass` or `renderColorizedResponse` — the existing `XYZ/`
mnemonic regex already two-tone-renders `W (WHITE)` correctly, and a new `ETN/` line
is covered by the same `[A-Z]{2,5}/` pattern.

### Unit 3 — `NcicQueryPanel.tsx` (modify)

1. **`QZ <term>` decoder command** — calls `lookupAnyCode`, renders a small NCIC-style
   block listing every matching domain/code/label. Type `QZ TOYOTA`→`VMA/TOYT`,
   `QZ TOYT`→TOYOTA, `QZ W`→WHITE (race). No backend call.
2. **Code-tolerant `QV`** — before the existing search, expand any token that is a known
   `VMA` make code to its label (`TOYT`→Toyota). State codes in `QD` already work.
3. Welcome-screen command box + input placeholders updated to list `QZ`.

### Unit 4 — Tests `client/src/constants/__tests__/ncicCodes.test.ts` (new)

- Round-trip `encode`/`decode` for each domain.
- Hispanic → `RAC/U` + `ETN/H` behavior.
- `normalizeHeight` / `normalizeWeight` across input shapes.
- Unknown value → uppercased fallback, never throws.
- Authoritative spot-checks: TOYT, CHEV, FORD, HOND; BLU/RED/WHI; the W/B/I/A/U set;
  `4D`/`PK`; UT state; Utah DL class D/M.
- `lookupAnyCode` returns expected matches both directions.

## Data flow

```
D1 (plain labels) ─► API ─► NcicQueryPanel ─► ncicFormatter.fmtCoded() ─► coded+label text
                                  ▲
        operator input ─► QV make-code expand / QZ decode (ncicCodes helpers)
```

## Out of scope (honest)

- Full NCIC offense manual (~1,000 entries) — curated subset only this pass.
- Attribute-based vehicle search needing new server WHERE clauses (color/style search).
- Any server change or D1 migration.

## Operational notes

- Bump `CACHE_NAME` in `client/public/sw.js` (client change — project rule).
- Ship via feature branch → PR (per project feedback rule), not direct push to main.
- CI gates: `client-typecheck`, `client-tests` (new vitest), `client-build`.

## Risks

- **Code accuracy.** NCIC make/color/style and Utah statute citations must be correct.
  Mitigation: spot-check tests on the highest-frequency codes; curated offense set kept
  small enough to verify each citation; unknown values degrade gracefully to the raw
  label rather than emitting a wrong code.
- **Readability regression.** Codes alone are opaque; mitigated by the always-on
  decoded label in parentheses.
