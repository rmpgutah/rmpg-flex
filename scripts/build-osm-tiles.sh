#!/usr/bin/env bash
# ============================================================
# RMPG Flex — OSM overlay tile builder
# ============================================================
# Builds PMTiles archives of statewide Utah OpenStreetMap reference data and
# uploads them to R2 (system-essentials/tiles/), where src/routes/tiles.ts
# serves them as /api/tiles/<name>/{z}/{x}/{y}.mvt.
#
# OSM is a DATA source only — this never touches the Mapbox basemap or style.
#
# Usage:
#   scripts/build-osm-tiles.sh --count-only        # measure, write counts doc, no tiles
#   scripts/build-osm-tiles.sh                     # full build + upload
#   scripts/build-osm-tiles.sh --group safety      # one group
#   scripts/build-osm-tiles.sh --skip-download     # reuse the cached extract
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${ROOT}/.osm-build"
CATALOG="${ROOT}/config/osm-layers.json"
COUNTS_DOC="${ROOT}/docs/osm-utah-feature-counts.md"
BUCKET="system-essentials"

COUNT_ONLY=0
SKIP_DOWNLOAD=0
ONLY_GROUP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --count-only)    COUNT_ONLY=1; shift ;;
    --skip-download) SKIP_DOWNLOAD=1; shift ;;
    --group)         ONLY_GROUP="${2:?--group needs a name}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ── Preflight ───────────────────────────────────────────────
# Fail up front with an actionable message rather than partway through a
# 250 MB pipeline.
missing=0
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "MISSING: $1 — install with: $2" >&2
    missing=1
  fi
}
need osmium     "brew install osmium-tool"
need tippecanoe "brew install tippecanoe"
need jq         "brew install jq"
need node       "https://nodejs.org (v20+)"
if [[ $COUNT_ONLY -eq 0 ]]; then
  need npx      "ships with node"
fi
if [[ $missing -ne 0 ]]; then
  echo "" >&2
  echo "Install the tools above, then re-run." >&2
  exit 1
fi

[[ -f "$CATALOG" ]] || { echo "catalog not found: $CATALOG" >&2; exit 1; }

mkdir -p "$WORK"

EXTRACT_URL="$(jq -r '.extract' "$CATALOG")"
EXTRACT="${WORK}/utah-latest.osm.pbf"

# NOT `GROUPS` — that is a bash special variable holding the user's group IDs.
# Assigning to it is silently ignored and $GROUPS then yields a numeric GID
# (20 = staff on macOS), so every group name becomes "20". Passes bash -n and
# code review; fails only at runtime.
#
# Validated BEFORE the download below — a typo'd --group name should fail fast
# rather than waste a ~160 MB download first.
OSM_GROUPS="$(jq -r '.groups[].name' "$CATALOG")"
if [[ -n "$ONLY_GROUP" ]]; then
  echo "$OSM_GROUPS" | grep -qx "$ONLY_GROUP" || { echo "unknown group: $ONLY_GROUP" >&2; exit 2; }
  OSM_GROUPS="$ONLY_GROUP"
fi

# ── Download ────────────────────────────────────────────────
if [[ $SKIP_DOWNLOAD -eq 0 || ! -f "$EXTRACT" ]]; then
  if [[ $SKIP_DOWNLOAD -eq 1 ]]; then
    echo "==> --skip-download requested, but no cached extract found — downloading anyway" >&2
  fi
  echo "==> Downloading Utah extract (~250 MB)"
  curl -fL --progress-bar -o "${EXTRACT}.tmp" "$EXTRACT_URL"
  mv "${EXTRACT}.tmp" "$EXTRACT"
else
  echo "==> Reusing cached extract: $EXTRACT"
fi

EXTRACT_DATE="$(osmium fileinfo -e -g data.timestamp.last "$EXTRACT" 2>/dev/null | cut -dT -f1 || echo unknown)"
echo "==> Extract data timestamp: $EXTRACT_DATE"

# ── Per-group filter + transform ────────────────────────────
# Emits ${WORK}/<group>.geojsonseq and ${WORK}/<group>.counts.json for every
# group. Both modes need this; only the full build goes on to tippecanoe.
declare -a BUILT_GROUPS=()

for g in $OSM_GROUPS; do
  echo ""
  echo "==> [$g] filtering"
  # NOT `mapfile` — that is bash 4+, and macOS /bin/bash is 3.2. On 3.2 mapfile
  # is a missing builtin, FILTERS stays empty, and osmium would filter NOTHING —
  # producing an archive of the entire state instead of erroring.
  FILTERS=()
  while IFS= read -r f; do
    [[ -n "$f" ]] && FILTERS+=("$f")
  done < <(jq -r --arg g "$g" \
    '.groups[] | select(.name==$g) | [.categories[].filters[]] | unique | .[]' "$CATALOG")
  [[ ${#FILTERS[@]} -gt 0 ]] || { echo "[$g] no filters resolved from catalog" >&2; exit 1; }

  osmium tags-filter --overwrite -o "${WORK}/${g}.osm.pbf" "$EXTRACT" "${FILTERS[@]}"

  echo "==> [$g] exporting + transforming"
  # osmium export silently drops objects whose geometry cannot be assembled —
  # notably wr/ relations, and `jurisdiction` is wr/-only, where a silent drop
  # is most consequential. --error-file surfaces those instead of letting them
  # vanish with no trace.
  osmium export -f geojsonseq --overwrite -o "${WORK}/${g}.raw.geojsonseq" \
    --error-file "${WORK}/${g}.export-errors.txt" "${WORK}/${g}.osm.pbf"
  if [[ -s "${WORK}/${g}.export-errors.txt" ]]; then
    echo "[$g] ABORT: osmium export reported geometry errors — refusing to ship a short archive." >&2
    echo "[$g] See ${WORK}/${g}.export-errors.txt" >&2
    exit 1
  fi

  node "${ROOT}/scripts/osm/transform.mjs" --group "$g" \
    < "${WORK}/${g}.raw.geojsonseq" \
    > "${WORK}/${g}.geojsonseq" \
    2> "${WORK}/${g}.counts.json"

  # transform.mjs writes its summary as the LAST stderr line; keep only that.
  tail -n 1 "${WORK}/${g}.counts.json" > "${WORK}/${g}.counts.tmp"
  mv "${WORK}/${g}.counts.tmp" "${WORK}/${g}.counts.json"

  # A malformed line is a feature we silently did not write. Absence in a rendered
  # layer must mean "not mapped in OSM", never "our pipeline dropped it" — so this
  # fails the build rather than shipping a short archive.
  MALFORMED_COUNT="$(jq -r '.malformed' "${WORK}/${g}.counts.json")"
  if [[ "$MALFORMED_COUNT" != "0" ]]; then
    echo "[$g] ABORT: ${MALFORMED_COUNT} malformed input line(s) — refusing to ship a short archive." >&2
    echo "[$g] Inspect ${WORK}/${g}.raw.geojsonseq. Override only if you understand the loss." >&2
    exit 1
  fi

  jq -r '"    " + (.counts | to_entries | map("\(.key)=\(.value)") | join("  "))' "${WORK}/${g}.counts.json"
  BUILT_GROUPS+=("$g")
done

# ── Counts doc ──────────────────────────────────────────────
write_counts_doc() {
  {
    echo "# Utah OSM Feature Counts"
    echo ""
    echo "Generated by \`scripts/build-osm-tiles.sh --count-only\`."
    echo "Extract data timestamp: **${EXTRACT_DATE}**"
    echo ""
    echo "Grounding record for the spec's drop rule: any category under 50"
    echo "statewide features is removed from the layer set before client work,"
    echo "unless it is high-consequence and low-frequency by nature (mine"
    echo "shafts, sally ports, helipads, riser inlets). Record the reason when keeping one."
    echo ""
    echo "| Group | Category | Features | Keep? | Reason |"
    echo "|---|---|---:|---|---|"
    for g in "${BUILT_GROUPS[@]}"; do
      jq -r --arg g "$g" '.counts | to_entries[] |
        "| \($g) | \(.key) | \(.value) | " +
        (if .value >= 50 then "yes | " else "**review** | " end) + " |"' \
        "${WORK}/${g}.counts.json"
    done
    echo ""
    echo "Skipped (matched a group filter but no category rule) and malformed:"
    echo ""
    echo "| Group | Skipped | Malformed |"
    echo "|---|---:|---:|"
    for g in "${BUILT_GROUPS[@]}"; do
      jq -r --arg g "$g" '"| \($g) | \(.skipped) | \(.malformed) |"' "${WORK}/${g}.counts.json"
    done
  } > "$COUNTS_DOC"
  echo ""
  echo "==> Wrote $COUNTS_DOC"
}

if [[ $COUNT_ONLY -eq 1 ]]; then
  write_counts_doc
  echo "==> Count-only run complete. No tiles generated, nothing uploaded."
  exit 0
fi

echo ""
# ── Tile generation ─────────────────────────────────────────
for g in "${BUILT_GROUPS[@]}"; do
  echo ""
  echo "==> [$g] tiling"

  GEOMETRY="$(jq -r --arg g "$g" '.groups[] | select(.name==$g) | .geometry' "$CATALOG")"
  # Archive minzoom = LOWEST category minzoom in the group. Tippecanoe's
  # minimum-zoom is per tile-LAYER, and all of a group's categories share one
  # layer, so a per-category value here would omit features a lower-gated
  # category needs. Per-category gating is client-side (Plan 2).
  MINZOOM="$(node -e "import('${ROOT}/scripts/osm/catalog.mjs').then(m=>console.log(m.archiveMinZoom('$g')))")"

  TIPPE_ARGS=(
    -o "${WORK}/osm-${g}.pmtiles"
    --force
    --layer="${g}"
    --minimum-zoom="${MINZOOM}"
    --maximum-zoom=16
    --read-parallel
    # ── Statewide completeness: disable ALL THREE thinning mechanisms ──
    # 1. --drop-rate=1 : tippecanoe's DEFAULT (~2.5) drops points at low zoom
    #    even when nothing is specified. This is the one that silently thins a
    #    statewide capture. `1` means keep every feature.
    # 2/3. --no-feature-limit / --no-tile-size-limit : per-tile caps that
    #    otherwise discard overflow features without an error.
    # Affordable only because transform.mjs stamps per-feature tippecanoe.minzoom
    # (see Task 4) — a pole is absent from a z10 tile because of its own gate, not
    # because the tiler threw it away.
    --drop-rate=1
    --no-feature-limit
    --no-tile-size-limit
  )

  case "$GEOMETRY" in
    polygon)
      # Independent simplification of adjacent jurisdiction polygons opens
      # visible gaps along shared borders — a jurisdiction map that lies about
      # where one agency's authority ends.
      TIPPE_ARGS+=(--no-tiny-polygon-reduction --detect-shared-borders --simplification=2)
      ;;
    line)
      TIPPE_ARGS+=(--no-tiny-polygon-reduction --simplification=4)
      ;;
    *)
      # Points and mixed: NEVER --drop-densest-as-needed, and never rely on the
      # default drop-rate (disabled above). Absence must mean "not mapped", not
      # "dropped to fit a tile budget".
      TIPPE_ARGS+=(--no-tiny-polygon-reduction --simplification=4)
      ;;
  esac

  tippecanoe "${TIPPE_ARGS[@]}" "${WORK}/${g}.geojsonseq"

  ls -lh "${WORK}/osm-${g}.pmtiles" | awk '{print "    archive size: " $5}'
done

# ── Upload archives ─────────────────────────────────────────
# Archives FIRST, manifest LAST. A stale manifest beside fresh archives is
# detectable; a fresh manifest beside a half-uploaded set is not.
for g in "${BUILT_GROUPS[@]}"; do
  echo "==> [$g] uploading"
  npx wrangler r2 object put "${BUCKET}/tiles/osm-${g}.pmtiles" \
    --file "${WORK}/osm-${g}.pmtiles" \
    --content-type application/octet-stream \
    --remote
done

# ── Manifest ────────────────────────────────────────────────
echo ""
echo "==> Writing manifest"
{
  echo "{"
  echo "  \"generated_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"extract\": \"utah-latest.osm.pbf\","
  echo "  \"extract_date\": \"${EXTRACT_DATE}\","
  echo "  \"groups\": {"
  first=1
  for g in "${BUILT_GROUPS[@]}"; do
    [[ $first -eq 0 ]] && echo ","
    first=0
    printf '    "%s": ' "$g"
    jq -c '{feature_count: (.counts | to_entries | map(.value) | add),
            categories: (.counts | to_entries | map(select(.value > 0)) | map(.key))}' \
      "${WORK}/${g}.counts.json" | tr -d '\n'
  done
  echo ""
  echo "  }"
  echo "}"
} > "${WORK}/osm-manifest.json"

jq . "${WORK}/osm-manifest.json" > /dev/null || { echo "manifest is not valid JSON" >&2; exit 1; }

npx wrangler r2 object put "${BUCKET}/tiles/osm-manifest.json" \
  --file "${WORK}/osm-manifest.json" \
  --content-type application/json \
  --remote

echo ""
echo "==> Done. ${#BUILT_GROUPS[@]} archives + manifest uploaded."
echo "    Verify: npx wrangler r2 object get ${BUCKET}/tiles/osm-manifest.json --remote --pipe"
