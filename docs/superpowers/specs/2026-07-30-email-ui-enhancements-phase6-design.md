# Email System — Phase 6: Client UI Enhancements — Design

**Date:** 2026-07-30
**Status:** Draft — candidate list from codebase audit, pending approval
**Scope:** Extends the 5-phase email upgrade roadmap (`docs/superpowers/specs/2026-07-30-email-system-upgrade-design.md`) with a 6th phase covering client-side UI. Independent of Phases 2-5 (backend); can ship in any order relative to them.

---

## 1. Context

An audit of the client email UI (`client/src/pages/EmailPage.tsx`, `AdminEmailTab.tsx`, `AdminEmailRulesTab.tsx`, `AdminEmailAuditTab.tsx`, and `client/src/components/email/`) against every backend route in `src/routes/email.ts` found 25 concrete gaps: backend capabilities with no client UI at all, rough/incomplete UX on features that do exist, admin visibility gaps, and a few accessibility rough edges. Full findings below, organized by category with effort estimate (S/M/L).

## 2. Goals

Close the highest-value gaps first — particularly the two items created by this session's own Phase 1 backend work (items 11-12: the new `ATTACHMENTS_TOO_LARGE`/`EMAIL_RATE_LIMITED` error codes currently fall into a generic error message with no distinct UI) — then work outward to the rest of the list by priority.

## 3. Candidate list (25 items, 6 categories)

### A. No client UI for an existing backend endpoint (10 items)
1. Snooze/unsnooze emails — `POST /messages/:id/snooze`, `GET /snoozed`, `DELETE /snoozed/:id` fully unreachable. **M**
2. Blocked-senders management (list + unblock) — only block exists, no review/undo screen. **S-M**
3. Mailbox stats dashboard (`GET /mailbox-stats`) — zero client callers. **M**
4. Outbox visibility/retry tray (`GET /outbox`) — durable send-queue status invisible to the sender. **M-L**
5. Draft list/send via server draft store (`/drafts`, `/drafts/:id/send`) — orphaned; verify against Graph-folder-backed local drafts, wire or remove. **M**
6. Contacts/People directory (`GET /people`) — only autocomplete exists, no browse screen. **S**
7. Reverse entity→email links (`GET /links/by-entity/:type/:id`) — verify `LinkedEmailsSection.tsx` coverage; likely needs wiring for incident/warrant detail pages. **M**
8. Server-side thread grouping (`GET /threads`) — confirm client isn't re-implementing this ad hoc. **M**
9. Folder "empty" action (`POST /folders/:id/empty`) — standard mailbox action, missing. **S**
10. Mailbox-level settings (`GET /settings/mailbox`) — only auto-reply wired, broader settings unused. **S**

### B. Compose & send UX (5 items)
11. **Surface `ATTACHMENTS_TOO_LARGE` (413)** — generic error today; add live "X MB / 25 MB" running total + dedicated message. **S**
12. **Surface `EMAIL_RATE_LIMITED` (429)** — generic error today; add cooldown-aware messaging. **S**
13. Drag-and-drop attachments — currently button-triggered file input only. **S-M**
14. Scheduled-send edit (currently cancel-only, forces full re-compose). **S**
15. Template authoring UI — templates are read-only in the client; create/edit/delete exist server-side only. **M**

### C. Admin & ops visibility (4 items)
16. Audit log search/filter/export — `AdminEmailAuditTab.tsx` has only a 3-way status filter and a hardcoded 200-row cap; no sender/subject/date search, no export. Real compliance gap for a police RMS. **M**
17. Rate-limit config visibility for admins (view current thresholds / who's throttled). **S (view) / M (editable)**
18. Cross-user outbox/retry monitoring for admins. **M**
19. Rule-hit effectiveness counters ("matched N times today") in `AdminEmailRulesTab.tsx`. **M**

### D. Safety & trust surfacing (3 items)
20. Visually distinguish autolinker (AI/regex-inferred) links from manually-created links in `EmailIncidentLinks` — an officer currently can't tell which needs review. **S-M**
21. Blocked-sender action needs confirmation + undo toast (ties to item 2). **S**
22. Image-proxy failures are silent (broken-image icon only) — no distinct "blocked/failed to load" messaging, which matters for evidentiary emails. **S**

### E. Accessibility (3 items)
23. Persistent `aria-label`s on to/cc/bcc fields (currently placeholder-text-only in places). **S**
24. Consistent Escape-to-close across compose-adjacent popovers (`TemplatePicker`, `EmailIncidentLinks` form). **S**
25. Loading/skeleton state for `EmailBodyFrame` iframe (brief blank flash on every message open). **S**

## 4. Prioritization

**Immediate (this phase, batch 1)** — small, high-value, closes gaps this session's own backend work created:
- #11, #12 (surface new error codes)
- #16 (audit log search/filter — compliance-relevant)
- #2 (blocked-senders list/unblock)

**Batch 2** — round out safety/trust and remaining small items (#20, #21, #22, #23, #24, #25, #9, #6, #10).

**Batch 3** — larger builds requiring more design judgment (#1 snooze, #3 stats dashboard, #4 outbox tray, #5 drafts reconciliation, #7 reverse links, #8 thread-grouping audit, #13 drag-drop, #14 schedule edit, #15 template authoring, #17/#18/#19 admin ops).

## 5. Non-goals

- Nothing in this phase touches the backend routes themselves (Phase 1-5 own that) except where a UI needs a genuinely new endpoint not already listed above — none identified in the audit.
- No redesign of EmailPage.tsx's overall structure — this is additive UI, not a rewrite of the (large, per CLAUDE.md megafile list) existing page.

## 6. Next step

This is a candidate list, not yet an approved design — the batching above is a suggestion. Once the user confirms scope/batch order, invoke `superpowers:writing-plans` for the approved batch.
