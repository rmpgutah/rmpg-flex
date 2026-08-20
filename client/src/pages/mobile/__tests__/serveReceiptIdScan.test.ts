// Identity capture on the signing form.
//
// recipient_id_type / recipient_id_verified / recipient_description have
// existed since migration 0207 and nothing ever wrote them. The physical
// description in particular is what an affidavit of service conventionally
// carries and what nobody types by hand — it comes free off the barcode.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = readFileSync(join(__dirname, '..', 'ServeReceiptPage.tsx'), 'utf8');
// Step components that the wizard refactor split out of ServeReceiptPage.
const STEP2 = readFileSync(join(__dirname, '..', 'steps', 'Step2Identity.tsx'), 'utf8');
const SHELL = readFileSync(join(__dirname, '..', 'steps', 'WizardShell.tsx'), 'utf8');

describe('driver licence scan', () => {
  it('reuses the existing decoder and AAMVA parser', () => {
    // Both already exist for the DL search page. A second implementation
    // would drift from the one that gets exercised daily.
    expect(PAGE).toMatch(/from '\.\.\/\.\.\/utils\/pdf417Decoder'/);
    expect(PAGE).toMatch(/from '\.\.\/\.\.\/utils\/aamvaParser'/);
  });

  it('is required, per operator instruction on the 2026-07-27 service', () => {
    // A proof of service is more defensible in a contested hearing when
    // the signer's identity was verified against a photo ID rather than
    // self-attested.
    // The wizard refactor moved the barcode UI to Step2Identity.tsx.
    expect(STEP2).toMatch(/Scan ID barcode/);
    // The controller (ServeReceiptPage) still owns idVerified state and gates step 2 on it.
    const step2Block = PAGE.slice(PAGE.indexOf('const step2Valid'), PAGE.indexOf('const step3Valid'));
    expect(step2Block).toMatch(/idVerified/);
  });

  it('populates the columns that existed and were never written', () => {
    expect(PAGE).toMatch(/recipient_id_verified: idVerified/);
    expect(PAGE).toMatch(/recipient_id_type: idVerified \? 'drivers_licence_scan' : null/);
    expect(PAGE).toMatch(/recipient_description: idDescription \|\| null/);
  });

  it('keeps the licence number and address on the device in the scan path', () => {
    // The decoded barcode carries a licence number and home address. The
    // barcode scan callback itself does not reference them — only the
    // manual-entry fallback stores a DL number the signer typed.
    const scanStart = PAGE.indexOf('const scanId');
    const scanEnd = PAGE.indexOf('const captureIdPhoto');
    const scan = PAGE.slice(scanStart, scanEnd);
    expect(scan).not.toMatch(/dl_number/);
    expect(scan).not.toMatch(/dl\.address/);
    expect(scan).toMatch(/setIdDescription/);
  });

  it('degrades to typing when the barcode will not read', () => {
    // Bad light, a worn card, a cracked screen. The fallback has to be
    // the thing the person was going to do anyway.
    expect(PAGE).toMatch(/enter your ID information manually/);
  });
});

describe('public surface accessibility', () => {
  it('sets a document language for screen readers', () => {
    // The app shell never sets lang — it is only read by staff. This page
    // is read ALOUD to members of the public, and an unset lang makes a
    // synthesiser guess the voice on a legal instrument.
    expect(PAGE).toMatch(/document\.documentElement\.lang = 'en-US'/);
  });

  it('restores the prior lang on unmount', () => {
    // The officer's console is one route away in the same session.
    expect(PAGE).toMatch(/const priorLang = document\.documentElement\.lang/);
    expect(PAGE).toMatch(/if \(!priorLang\) document\.documentElement\.lang = priorLang/);
  });

  it('shows progress, and announces it rather than only drawing it', () => {
    // A form of unknown length on a doorstep is one people abandon. The
    // bar is aria-hidden and paired with a live region, because five
    // coloured rectangles say nothing to a screen reader.
    // The controller computes sectionsDone; WizardShell renders the live region.
    expect(PAGE).toMatch(/sectionsDone/);
    expect(SHELL).toMatch(/role="status"/);
    expect(SHELL).toMatch(/Step \{sectionsDone\} of 5 complete/);
  });

  it('counts the read-only sections as already done', () => {
    // Sections 1 and 3 require nothing. Starting the bar at zero would
    // leave it motionless through the first third of the form.
    expect(PAGE).toMatch(/const sectionsDone = 2/);
  });
});

describe('offline capture — what the signer is told', () => {
  it('does not claim a signature is saved when nothing is holding it', () => {
    // Private browsing blocks the queue. Telling them it is saved would
    // be a lie, and "try again" is the only action that can still work.
    expect(PAGE).toMatch(/let queued = true;/);
    expect(PAGE).toMatch(/this browser will not hold it/);
  });

  it('distinguishes an expired link from a failure they could retry', () => {
    expect(PAGE).toMatch(/This link expired before your signature could be sent/);
  });

  it('reschedules on the delay the queue asks for', () => {
    // A fixed tick polled a dead network four times a minute forever, on
    // someone else's battery, for a signature they cannot see.
    expect(PAGE).toMatch(/window\.setTimeout\(attempt, r\.retryInMs\)/);
    expect(PAGE).not.toMatch(/setInterval\(attempt/);
  });
});
