// Regression: two setters in one handler must both survive.
//
// ServeAttemptModal derives ~17 setters from a single `draft` object.
// They originally spread `draft` captured from the render closure, so a
// handler calling two of them lost the first — the second wrote back the
// PRE-click value. In the UI that meant Personal Service and Substitute
// Service could not be selected at all (their handler calls
// setAttemptType then setFailedReason), while "Failed Attempt" worked
// because it is the one branch that skips the second call. Picking a
// disposition code failed the same way.
//
// This pins the update SHAPE, which is what actually broke. A component
// test would need the modal's full context (GPS, photos, API) to render.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'ServeAttemptModal.tsx'), 'utf8');

describe('ServeAttemptModal draft setters', () => {
  it('never spreads the render-closure draft', () => {
    const stale = SRC.match(/setDraft\(\{\s*\.\.\.draft\b/g) ?? [];
    expect(
      stale,
      'setDraft({ ...draft, x }) captures the draft at render time. Two setters '
      + 'in one handler then discard the first. Use setDraft((prev) => ({ ...prev, x })).',
    ).toEqual([]);
  });

  it('uses functional updates for every derived setter', () => {
    const functional = SRC.match(/setDraft\(\(prev\) => \(\{ \.\.\.prev,/g) ?? [];
    expect(functional.length).toBeGreaterThanOrEqual(17);
  });

  it('still calls both setters when an attempt type is picked', () => {
    // The two-setter handler is the thing that exposed the bug; if it is
    // ever collapsed to one, this test should be revisited rather than
    // silently passing for the wrong reason.
    expect(SRC).toMatch(/setAttemptType\(card\.type\);\s*\n\s*if \(card\.type !== 'failed'\) setFailedReason\(null\);/);
  });
});

describe('ServeReceiptActions modal containment', () => {
  // Found live 2026-07-27: the panel rendered as a DOM descendant of the
  // job card with no dialog semantics and no focus management, so focus
  // stayed on the trigger behind the overlay. A Return keypress — routine
  // after typing on a phone keyboard — then activated whichever Yes/No
  // button held focus and silently reset the officer's intake.
  const ACTIONS = readFileSync(join(__dirname, '..', 'ServeReceiptActions.tsx'), 'utf8');

  it('portals out of the job card', () => {
    expect(ACTIONS).toMatch(/createPortal\(/);
    expect(ACTIONS).toMatch(/document\.body,/);
  });

  it('declares dialog semantics', () => {
    expect(ACTIONS).toMatch(/role="dialog"/);
    expect(ACTIONS).toMatch(/aria-modal="true"/);
  });

  it('moves focus into the panel on open', () => {
    expect(ACTIONS).toMatch(/panelRef\.current\?\.focus\(\)/);
  });
});

describe('attempt → Civil Process Record integration', () => {
  const MODAL = readFileSync(join(__dirname, '..', 'ServeAttemptModal.tsx'), 'utf8');
  const ACTIONS = readFileSync(join(__dirname, '..', 'ServeReceiptActions.tsx'), 'utf8');

  it('presents the record on the attempt completion screen', () => {
    expect(MODAL).toMatch(/Civil Process Record/);
    expect(MODAL).toMatch(/<ServeReceiptActions/);
  });

  it('offers it ONLY for attempts that actually delivered something', () => {
    // A posting or a failed attempt has no recipient to sign. Offering the
    // form there would invite a signature on a service that did not happen.
    expect(MODAL).toMatch(/attemptType === 'personal' \|\| attemptType === 'substitute'/);
  });

  it('carries the attempt answers over rather than re-asking them', () => {
    expect(MODAL).toMatch(/isNamedParty: attemptType === 'personal'/);
    expect(MODAL).toMatch(/recipientName: personServedName/);
  });

  it('still asks the two questions the attempt log never captured', () => {
    // Seeding pre-answers the intake; it must not skip it. Residency and
    // premises type are what separate a co-habitant from a substitute, and
    // the attempt log asks neither — deriving a form without them would be
    // deriving it from facts nobody established.
    expect(ACTIONS).toMatch(/seed\?\.isNamedParty/);
    // The step always starts at intake, seeded or not. If this ever becomes
    // conditional on `seed`, a form would be derived from residency and
    // premises answers nobody gave.
    expect(ACTIONS).toMatch(/useState<Step>\('intake'\)/);
  });
});
