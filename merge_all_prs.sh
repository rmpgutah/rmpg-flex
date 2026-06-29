#!/bin/bash
set -e

LOG_FILE="/tmp/merge-all-prs.log"
RESULTS_FILE="/tmp/merge-all-results.txt"
PR_LIST_FILE="/tmp/open-prs.txt"

: > "$LOG_FILE"
: > "$RESULTS_FILE"

log() { echo "$(date '+%H:%M:%S') $*" | tee -a "$LOG_FILE"; }

# Ensure on main with latest
git checkout main 2>/dev/null
git fetch origin main 2>>"$LOG_FILE"
git reset --hard origin/main 2>>"$LOG_FILE"

gh pr list --repo rmpgutah/rmpg-flex --state open --json number,headRefName,baseRefName \
  --jq '.[] | select(.baseRefName == "main") | "\(.number) \(.headRefName)"' > "$PR_LIST_FILE"

TOTAL=$(wc -l < "$PR_LIST_FILE")
PASS=0
FAIL=0

while read -r PR_NUM BRANCH; do
  log "=== PR #$PR_NUM ($BRANCH) ==="

  # Fetch the PR branch and get its current tip
  git fetch origin "$BRANCH" 2>>"$LOG_FILE" || {
    log "PR #$PR_NUM: fetch failed"; echo "$PR_NUM|$BRANCH|FAIL|fetch" >> "$RESULTS_FILE"
    ((FAIL++)); continue
  }

  ORIG_TIP=$(git rev-parse "origin/$BRANCH" 2>/dev/null) || {
    log "PR #$PR_NUM: no remote ref"; echo "$PR_NUM|$BRANCH|FAIL|no-ref" >> "$RESULTS_FILE"
    ((FAIL++)); continue
  }

  git checkout -b "merge-pr-$PR_NUM" "$ORIG_TIP" 2>>"$LOG_FILE" || {
    log "PR #$PR_NUM: checkout failed"; echo "$PR_NUM|$BRANCH|FAIL|checkout" >> "$RESULTS_FILE"
    ((FAIL++)); continue
  }

  # Merge main with -X theirs
  if git merge origin/main -X theirs --no-edit 2>>"$LOG_FILE"; then
    log "PR #$PR_NUM: merge clean, committing"
    # Check if there are staged changes to commit
    if git diff --cached --quiet 2>/dev/null; then
      log "PR #$PR_NUM: nothing to commit (already up to date)"
    else
      git commit --no-edit 2>>"$LOG_FILE" || true
    fi
  else
    log "PR #$PR_NUM: merge conflicts, resolving modify/delete..."
    CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
    if [ -n "$CONFLICTS" ]; then
      echo "$CONFLICTS" | while read -r f; do
        git rm -f "$f" 2>/dev/null || git checkout --theirs "$f" 2>/dev/null || true
      done
    fi
    if git diff --name-only --diff-filter=U 2>/dev/null | grep -q .; then
      log "PR #$PR_NUM: UNRESOLVED conflicts remain"
      git diff --name-only --diff-filter=U 2>/dev/null | while read -r f; do
        log "  UNRESOLVED: $f"
      done
      echo "$PR_NUM|$BRANCH|FAIL|conflict" >> "$RESULTS_FILE"
      git merge --abort 2>/dev/null || true
      git checkout main 2>/dev/null
      git branch -D "merge-pr-$PR_NUM" 2>/dev/null || true
      ((FAIL++)); continue
    fi
    git commit --no-edit 2>>"$LOG_FILE" || {
      log "PR #$PR_NUM: commit failed"
      echo "$PR_NUM|$BRANCH|FAIL|commit" >> "$RESULTS_FILE"
      git checkout main 2>/dev/null
      git branch -D "merge-pr-$PR_NUM" 2>/dev/null || true
      ((FAIL++)); continue
    }
  fi

  # Push
  if ! git push -f origin "merge-pr-$PR_NUM:$BRANCH" 2>>"$LOG_FILE"; then
    log "PR #$PR_NUM: push failed"; echo "$PR_NUM|$BRANCH|FAIL|push" >> "$RESULTS_FILE"
    ((FAIL++)); continue
  fi

  sleep 10

  # Try merge via gh (squash -> merge -> auto)
  PR_TITLE=$(gh pr view "$PR_NUM" --repo rmpgutah/rmpg-flex --json title --jq '.title' 2>>"$LOG_FILE")
  MERGE_MSG="$PR_TITLE (#$PR_NUM)"
  MERGED=false

  if gh pr merge "$PR_NUM" --repo rmpgutah/rmpg-flex --squash --admin -t "$MERGE_MSG" 2>>"$LOG_FILE"; then
    log "PR #$PR_NUM: MERGED (squash)"; echo "$PR_NUM|$BRANCH|MERGED|squash" >> "$RESULTS_FILE"
    ((PASS++)); MERGED=true
  elif gh pr merge "$PR_NUM" --repo rmpgutah/rmpg-flex --merge --admin -t "$MERGE_MSG" 2>>"$LOG_FILE"; then
    log "PR #$PR_NUM: MERGED (merge)"; echo "$PR_NUM|$BRANCH|MERGED|merge" >> "$RESULTS_FILE"
    ((PASS++)); MERGED=true
  elif gh pr merge "$PR_NUM" --repo rmpgutah/rmpg-flex --admin 2>>"$LOG_FILE"; then
    log "PR #$PR_NUM: MERGED (auto)"; echo "$PR_NUM|$BRANCH|MERGED|auto" >> "$RESULTS_FILE"
    ((PASS++)); MERGED=true
  fi

  if [ "$MERGED" = false ]; then
    log "PR #$PR_NUM: --squash/--merge/--auto failed, trying squash-onto-main approach..."

    # Re-fetch main (it may have advanced since earlier PRs merged)
    git fetch origin main 2>>"$LOG_FILE"

    # Get original PR tip
    ORIG_TIP=$(gh pr view "$PR_NUM" --repo rmpgutah/rmpg-flex --json commits --jq '.commits[0].oid' 2>>"$LOG_FILE")
    if [ -n "$ORIG_TIP" ] && [ "$ORIG_TIP" != "null" ]; then
      git checkout -b "squash-pr-$PR_NUM" origin/main 2>>"$LOG_FILE"

      if git merge --squash -X theirs "$ORIG_TIP" 2>>"$LOG_FILE"; then
        git commit -m "$MERGE_MSG" 2>>"$LOG_FILE" || true
        git push -f origin "squash-pr-$PR_NUM:$BRANCH" 2>>"$LOG_FILE"
        sleep 10

        if gh pr merge "$PR_NUM" --repo rmpgutah/rmpg-flex --squash --admin -t "$MERGE_MSG" 2>>"$LOG_FILE"; then
          log "PR #$PR_NUM: MERGED (squash-onto-main)"; echo "$PR_NUM|$BRANCH|MERGED|squash-onto-main" >> "$RESULTS_FILE"
          ((PASS++)); MERGED=true
        elif gh pr merge "$PR_NUM" --repo rmpgutah/rmpg-flex --merge --admin -t "$MERGE_MSG" 2>>"$LOG_FILE"; then
          log "PR #$PR_NUM: MERGED (merge-onto-main)"; echo "$PR_NUM|$BRANCH|MERGED|merge-onto-main" >> "$RESULTS_FILE"
          ((PASS++)); MERGED=true
        fi
      fi
      git checkout main 2>/dev/null
      git branch -D "squash-pr-$PR_NUM" 2>/dev/null || true
    fi

    if [ "$MERGED" = false ]; then
      log "PR #$PR_NUM: FAILED all methods"; echo "$PR_NUM|$BRANCH|FAIL|merge-failed" >> "$RESULTS_FILE"
      ((FAIL++))
    fi
  fi

  git checkout main 2>/dev/null
  git branch -D "merge-pr-$PR_NUM" 2>/dev/null || true

done < "$PR_LIST_FILE"

echo ""
echo "=== RESULTS ==="
echo "Total: $TOTAL | Pass: $PASS | Fail: $FAIL"
grep "FAIL" "$RESULTS_FILE" 2>/dev/null || echo "No failures!"
