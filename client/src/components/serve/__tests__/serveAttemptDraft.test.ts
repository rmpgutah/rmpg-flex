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
    expect(SRC).toMatch(/setAttemptType\(card\.type\);\s*\n\s*setDispositionCode\(''\);\s*\n\s*if \(card\.type !== 'failed'\) setFailedReason\(null\);/);
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

describe('refusal path', () => {
  const ACTIONS = readFileSync(join(__dirname, '..', 'ServeReceiptActions.tsx'), 'utf8');

  it('is attested by the officer, not the recipient', () => {
    // A person who refuses to sign will not tap a phone either. Asking the
    // refuser to record their own refusal produces nothing at all, which
    // is what the system did before: a refused service simply vanished.
    expect(ACTIONS).toMatch(/serve-receipts\/\$\{job\.id\}\/refusal/);
    expect(ACTIONS).toMatch(/They refused to sign/);
  });

  it('asks explicitly whether the documents were left', () => {
    // Service is complete when the papers are LEFT, refusal or not
    // (Utah R. Civ. P. 4(d)). Papers left is good service; papers retained
    // is a failed attempt. Inferring it from the refusal would collapse
    // two genuinely different outcomes into one.
    expect(ACTIONS).toMatch(/documents_left: docsLeft/);
    expect(ACTIONS).toMatch(/I left the documents in their presence/);
  });

  it('requires the officer to describe what happened', () => {
    expect(ACTIONS).toMatch(/disabled=\{busy \|\| !refusalReason\.trim\(\)\}/);
  });
});

describe('public signing surface', () => {
  const PAGE = readFileSync(
    join(__dirname, '..', '..', '..', 'pages', 'mobile', 'ServeReceiptPage.tsx'), 'utf8');

  it('scopes the light palette to the route and cleans up after itself', () => {
    // The officer's console surfaces are one route away in the same
    // session on the same device. Leaving the class on <html> would
    // invert the CAD console for the rest of the shift.
    expect(PAGE).toMatch(/classList\.add\('public-form'\)/);
    expect(PAGE).toMatch(/classList\.remove\('public-form'\)/);
  });
});

describe('paper transcription', () => {
  const ACTIONS = readFileSync(join(__dirname, '..', 'ServeReceiptActions.tsx'), 'utf8');

  it('closes the dead end the paper path shipped with', () => {
    // A blank could be printed and signed in ink with nowhere to put it.
    // completion_channel = 'paper' existed as a column and nothing wrote it.
    expect(ACTIONS).toMatch(/serve-receipts\/\$\{job\.id\}\/paper/);
    expect(ACTIONS).toMatch(/They completed it on paper/);
  });

  it('requires a photograph of the signed page', () => {
    // The wet signature is the evidence. Without the page there is only an
    // officer's assertion that someone signed something.
    expect(ACTIONS).toMatch(/signed_page_image: paperImage/);
    expect(ACTIONS).toMatch(/disabled=\{busy \|\| !paperImage \|\| !paperName\.trim\(\)\}/);
  });

  it('downscales before sending rather than posting a raw phone photo', () => {
    // Several megabytes into a database column is not storage.
    expect(ACTIONS).toMatch(/1600 \/ Math\.max\(img\.width, img\.height\)/);
    expect(ACTIONS).toMatch(/toDataURL\('image\/jpeg', 0\.8\)/);
  });

  it('stores the wording the paper carried, not today\'s copy', () => {
    // The signer initialled the sheet in their hand. Re-deriving the
    // attestations at transcription time would record them as agreeing to
    // whatever the code says now.
    expect(ACTIONS).toMatch(/attestations: attestationsFor\(variant/);
  });
});
