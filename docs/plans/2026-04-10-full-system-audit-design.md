# Full System Audit — Test-Driven Bug Discovery

**Date**: 2026-04-10
**Requester**: User asked to "resolve all issues and processes with RMPG Flex, buttons, data entry, saving, mapping, and paths, and ensure full workflow is 100% functional and saving"

## Problem

User reports broad UX issues across buttons, data entry, saving, mapping, and paths. However:
- 0 TypeScript errors (client and server)
- 256/256 unit tests passing
- Production health endpoint returns `ok`
- No uncaught exceptions in production logs

This means the bugs are **runtime/UX issues that automated checks don't catch**. The gap: the 256 existing tests are all unit tests for middleware and utilities — zero cover actual API routes, database writes, or end-to-end workflows. `supertest` is installed but never used. No browser tests exist.

## Goal

Build a safety net that catches the kinds of bugs the user is reporting:
1. Write integration tests that exercise full request→DB→response cycles
2. Write browser tests for critical UI workflows
3. Any test that fails = a real bug; fix it
4. Leave behind a regression suite so future changes don't break what we fix

## Scope

### Phase 1 — Integration tests (this session)
Using `supertest` against an isolated test database (no production data touched):

1. **Auth** — `POST /api/auth/login`, token refresh, 2FA gate
2. **Dispatch calls** — create, assign unit, status transitions, clear
3. **Dispatch units** — status change, GPS update
4. **Records: incidents** — create with offense, officer, person link, save, retrieve
5. **Records: persons** — create, search, MNI lookup
6. **Citations** — create with violations, auto-sum fines, save
7. **Maps: geofence** — district/beat lookup by GPS

### Phase 2 — Browser tests (this session)
Using Playwright for the 3 most critical UI flows:

1. Login → Dispatch console → create call → assign unit → clear
2. Login → Records → create person → create incident → link person
3. Login → Map → verify rendering → click beat → verify district lookup

### Phase 3 — Later sessions (out of scope)
Warrants, Fleet/vehicles, Personnel/HR, CRM, Email, Offline sync, Forensics, Court, Process Service

## Data safety strategy

**Do not touch production data.** Every test must:
- Use a fresh SQLite DB at `server/data/test-<uuid>.db` or in-memory
- Seed with minimal fixtures (admin user, 1 officer, 1 unit, 1 beat)
- Clean up temp DB after run
- Never connect to production DB file

Test DB setup helper will live at `server/tests/helpers/testDb.ts`.

## Test harness architecture

```
server/tests/
├── helpers/
│   ├── testDb.ts          # Creates isolated test DB + runs migrations
│   ├── testApp.ts         # Builds Express app for supertest
│   ├── fixtures.ts        # Seed admin, officer, unit, beat
│   └── auth.ts            # Helper to get JWT for test requests
├── integration/
│   ├── auth.test.ts
│   ├── dispatch-calls.test.ts
│   ├── dispatch-units.test.ts
│   ├── incidents.test.ts
│   ├── persons.test.ts
│   ├── citations.test.ts
│   └── geofence.test.ts
└── e2e/
    ├── playwright.config.ts
    ├── login-dispatch.spec.ts
    ├── login-records.spec.ts
    └── login-map.spec.ts
```

## What the tests will catch

- Save paths that silently fail (4xx/5xx responses, DB constraint violations)
- Missing required fields that cause "save does nothing" bugs
- Foreign key / referential integrity issues
- Auth middleware rejections on routes that should allow the user
- Business logic bugs (e.g., citation fine doesn't auto-sum)
- WebSocket broadcast paths that throw
- Map rendering failures (Playwright screenshots)
- Button clicks that don't trigger state changes

## What they won't catch

- Offline mode sync issues (IndexedDB simulation too complex for this session)
- Electron desktop-specific bugs (separate harness needed)
- Performance issues (load testing out of scope)
- Visual regressions (no baseline screenshots yet)

## Success criteria

1. At least 15 integration tests passing (Phase 1)
2. At least 3 Playwright tests passing (Phase 2)
3. Every bug discovered is either fixed in this session or filed as a follow-up
4. Test suite can be re-run by CI on every push
5. Production health endpoint still returns `ok` after deploy

## Risk

- **Test DB setup may reveal that route code is tightly coupled to the singleton `getDb()`** — may need to refactor for testability, increasing scope
- **Playwright setup may fail on macOS** — fallback is to use the Chrome extension MCP for spot checks
- **Some bugs may be environmental** (Electron-only, offline-only) and untestable from here

## Follow-ups (not in this session)

- Extend integration tests to Phase 3 modules
- Add visual regression baseline screenshots
- Add load/performance tests
- Add offline-mode test harness
- Wire test suite into CI (already has self-hosted runner)
