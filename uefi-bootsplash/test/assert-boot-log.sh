#!/usr/bin/env bash
# uefi-bootsplash/test/assert-boot-log.sh
# Asserts a captured boot log contains an expected substring. Exit 0 on match,
# exit 1 with a clear diagnostic (including the log's actual contents) otherwise.
set -euo pipefail

LOG_FILE="${1:?usage: assert-boot-log.sh <log-file> <expected-substring>}"
EXPECTED="${2:?usage: assert-boot-log.sh <log-file> <expected-substring>}"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "FAIL: log file not found: $LOG_FILE" >&2
  exit 1
fi

if grep -qaF -- "$EXPECTED" "$LOG_FILE"; then
  echo "PASS: found \"$EXPECTED\" in $LOG_FILE"
  exit 0
else
  echo "FAIL: did not find \"$EXPECTED\" in $LOG_FILE. Actual contents:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi
