# Archived design docs

A large slice of historical specs and plans was archived during the
2026-06-21 repo cleanup to keep `docs/` focused on active roadmap.

## What was archived

- **`docs/superpowers/specs/`** — every spec dated **before 2026-06-21**
  (55 files). The 6 specs from 2026-06-21 stay on `main` because they
  may still be referenced in active conversations.
- **`docs/plans/`** — the **entire directory** (101 files). The oldest
  plan dated to March 2026; all features described in these plans are
  shipped and live in `/src/` + `/client/src/`.

## Where to find them

Push branch on origin: **`archive/specs-plans-pre-cleanup-2026-06-21`**.

This branch is a snapshot of `main` HEAD as it stood immediately before
the cleanup PR. Every archived spec / plan is on it at its original
path — checkout the branch in a worktree or grep the GitHub UI directly.

```bash
# Browse a single archived spec
git show origin/archive/specs-plans-pre-cleanup-2026-06-21:docs/plans/2026-04-20-always-on-officer-tracking.md

# Or check the whole tree out in a worktree
git worktree add ../specs-archive archive/specs-plans-pre-cleanup-2026-06-21
```

The branch is **immutable by convention** — nothing should commit to it.
If you discover that an archived spec is still active, recover it with
`git show <ref>:<path> > <path>` and ship a normal PR restoring it.

## Why archive instead of delete outright

Git doesn't lose anything truly — `git log` on `main` still reaches the
deletion commit and the parent tree before it. The archive branch is
purely a convenience hook so old links into GitHub's file browser still
resolve. It also costs nothing.
