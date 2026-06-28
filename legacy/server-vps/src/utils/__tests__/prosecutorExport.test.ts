// ============================================================
// prosecutorExport — pure-function tests
// ============================================================
// Tests the manifest builder and verify-page generator. The
// zip orchestrator (bundleProsecutorPackage) is integration-
// tested elsewhere via the route's smoke test — Buffer-of-zip
// equality is fragile across archiver versions.

import { describe, it, expect } from 'vitest';
import {
  buildPackageManifest,
  buildVerifyHtml,
  type PackageManifestInput,
} from '../prosecutorExport';

const SAMPLE_INPUT: PackageManifestInput = {
  exported_at: '2026-04-28T12:00:00Z',
  exported_by: { id: 7, full_name: 'Sgt. Williams', badge: '3041' },
  case_reference: 'IA-2026-0042',
  event: {
    id: 9871,
    source: 'flex_ai',
    event_type: 'fcw',
    event_timestamp: '2026-04-28 11:55:00',
    unit_id: 12,
    call_sign: 'A-12',
    officer_name: 'Off. Ramirez',
    badge_number: '4189',
    latitude: 40.76,
    longitude: -111.89,
    speed_mph: 45,
    address: '1450 S State St',
    call_number: '2026-04-2891',
    duration_sec: 60,
    model_version: 'openpilot-0.9.5',
    confidence: 0.87,
  },
  clip: {
    object_key: 'file:///opt/rmpg-flex/server/data/dashcam-ai-evidence/2026-04-28/unit-12/9871-front.mp4',
    sha256: 'a'.repeat(64),
    size_bytes: 62_341_120,
    captured_at: '2026-04-28 11:55:00',
  },
  evidence_chain: [
    {
      id: 100,
      sha256: 'a'.repeat(64),
      captured_at: '2026-04-28 11:55:00',
      hashed_at: '2026-04-28 11:55:01',
      prev_hash_id: 99,
      signer: 'pubkey-base64',
      signature: 'sigbase64',
    },
  ],
  signing_public_key: 'pubkey-base64',
};

describe('buildPackageManifest', () => {
  it('produces a stable JSON-able object with required top-level keys', () => {
    const m = buildPackageManifest(SAMPLE_INPUT);
    expect(m.format).toBe('rmpg-flex-prosecutor-package/1');
    expect(m.exported_at).toBe(SAMPLE_INPUT.exported_at);
    expect(m.exported_by).toEqual(SAMPLE_INPUT.exported_by);
    expect(m.case_reference).toBe(SAMPLE_INPUT.case_reference);
    expect(m.event.id).toBe(9871);
    expect(m.clip.sha256).toBe(SAMPLE_INPUT.clip.sha256);
    expect(m.evidence_chain).toHaveLength(1);
    expect(m.signing_public_key).toBe('pubkey-base64');
  });

  it('embeds a verify-instructions block that names the algorithm', () => {
    const m = buildPackageManifest(SAMPLE_INPUT);
    expect(m.verify_instructions).toBeDefined();
    expect(m.verify_instructions.signature_algorithm).toBe('Ed25519');
    expect(m.verify_instructions.hash_algorithm).toBe('SHA-256');
  });

  it('omits case_reference when not provided', () => {
    const noCase = { ...SAMPLE_INPUT };
    delete noCase.case_reference;
    const m = buildPackageManifest(noCase);
    expect(m.case_reference).toBeUndefined();
  });
});

describe('buildVerifyHtml', () => {
  it('returns a self-contained HTML document', () => {
    const html = buildVerifyHtml(SAMPLE_INPUT);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('</html>');
  });

  it('embeds the SHA-256 of the clip and the public key', () => {
    const html = buildVerifyHtml(SAMPLE_INPUT);
    expect(html).toContain(SAMPLE_INPUT.clip.sha256);
    expect(html).toContain(SAMPLE_INPUT.signing_public_key);
  });

  it('embeds the case reference when present', () => {
    const html = buildVerifyHtml(SAMPLE_INPUT);
    expect(html).toContain('IA-2026-0042');
  });

  it('escapes potentially-injected user-controlled fields', () => {
    // exported_by.full_name might contain HTML — must be escaped
    const malicious = {
      ...SAMPLE_INPUT,
      exported_by: { id: 1, full_name: '<script>alert(1)</script>', badge: '0' },
    };
    const html = buildVerifyHtml(malicious);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
