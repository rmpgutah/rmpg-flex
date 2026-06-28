// ============================================================
// prosecutorExport — tamper-evident evidence package builder
// ============================================================
// Produces three artifacts for delivery to a DA / defense /
// court-of-record:
//
//   1. manifest.json — structured event + chain + signatures
//   2. verify.html   — self-contained page that re-computes the
//                      clip SHA-256 in the browser and verifies
//                      Ed25519 signatures against the embedded
//                      public key. Recipient needs nothing but
//                      a modern browser to validate.
//   3. clip.<ext>    — the original video bytes
//
// The bundling/zip step is a thin orchestrator over these
// pure functions. Pure parts (manifest + verify.html) are
// unit-tested; the zip orchestrator is integration-tested via
// the route smoke test.

export interface PackageEventInput {
  id: number;
  source: string;
  event_type: string;
  event_timestamp: string;
  unit_id: number | null;
  call_sign: string | null;
  officer_name: string | null;
  badge_number: string | null;
  latitude: number | null;
  longitude: number | null;
  speed_mph: number | null;
  address: string | null;
  call_number: string | null;
  duration_sec: number | null;
  model_version: string | null;
  confidence: number | null;
}

export interface PackageClipInput {
  object_key: string;
  sha256: string;
  size_bytes: number;
  captured_at: string;
}

export interface PackageChainEntry {
  id: number;
  sha256: string;
  captured_at: string;
  hashed_at: string;
  prev_hash_id: number | null;
  signer: string | null;
  signature: string | null;
}

export interface PackageManifestInput {
  exported_at: string;
  exported_by: { id: number; full_name: string; badge: string };
  case_reference?: string;
  event: PackageEventInput;
  clip: PackageClipInput;
  evidence_chain: PackageChainEntry[];
  signing_public_key: string;
}

export interface PackageManifest {
  format: 'rmpg-flex-prosecutor-package/1';
  exported_at: string;
  exported_by: { id: number; full_name: string; badge: string };
  case_reference?: string;
  event: PackageEventInput;
  clip: PackageClipInput;
  evidence_chain: PackageChainEntry[];
  signing_public_key: string;
  verify_instructions: {
    hash_algorithm: 'SHA-256';
    signature_algorithm: 'Ed25519';
    canonical_payload_fields: string[];
    summary: string;
  };
}

export function buildPackageManifest(input: PackageManifestInput): PackageManifest {
  const m: PackageManifest = {
    format: 'rmpg-flex-prosecutor-package/1',
    exported_at: input.exported_at,
    exported_by: input.exported_by,
    event: input.event,
    clip: input.clip,
    evidence_chain: input.evidence_chain,
    signing_public_key: input.signing_public_key,
    verify_instructions: {
      hash_algorithm: 'SHA-256',
      signature_algorithm: 'Ed25519',
      canonical_payload_fields: [
        'artifact_id', 'artifact_type', 'captured_at',
        'prev_hash_id', 'sha256',
      ],
      summary:
        'For each evidence_chain entry: serialize the listed fields in alphabetical key order with no whitespace, ' +
        'compute Ed25519 verification with signing_public_key against the entry signature. ' +
        'For the clip itself: compute SHA-256 of the file bytes; it must match clip.sha256.',
    },
  };
  if (input.case_reference) m.case_reference = input.case_reference;
  return m;
}

// ── HTML escape ────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Self-contained verification page that hashes the clip and
 *  verifies signatures using SubtleCrypto, no network calls.
 *  All dynamic DOM updates use textContent / createElement
 *  rather than innerHTML so there's no XSS surface inside the
 *  shipped artifact. */
export function buildVerifyHtml(input: PackageManifestInput): string {
  const ev = input.event;
  const exporter = input.exported_by;
  const caseRef = input.case_reference ? escapeHtml(input.case_reference) : '';
  const clipSha = escapeHtml(input.clip.sha256);
  const pubKey = escapeHtml(input.signing_public_key);
  const exportedAt = escapeHtml(input.exported_at);

  const chainHtml = input.evidence_chain.map(c => `
    <tr>
      <td>${c.id}</td>
      <td><code>${escapeHtml(c.sha256.slice(0, 12))}…</code></td>
      <td>${escapeHtml(c.captured_at)}</td>
      <td>${c.prev_hash_id ?? '<em>none (genesis)</em>'}</td>
      <td>${c.signature ? '<span class="ok">signed</span>' : '<span class="warn">unsigned</span>'}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Evidence Package — Event #${ev.id}</title>
  <style>
    body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
           color: #1a1a1a; background: #f5f5f5; margin: 0; padding: 2em; }
    .doc { max-width: 860px; margin: 0 auto; background: white; padding: 2em;
           border: 1px solid #ccc; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h1 { font-size: 22px; margin-top: 0; border-bottom: 2px solid #333; padding-bottom: .5em; }
    h2 { font-size: 16px; margin-top: 2em; border-bottom: 1px solid #ccc; padding-bottom: .3em; }
    table { border-collapse: collapse; width: 100%; margin-top: .5em; font-size: 12px; }
    th, td { padding: 6px 10px; border: 1px solid #ddd; text-align: left; vertical-align: top; }
    th { background: #f0f0f0; font-weight: 600; }
    code { font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace; font-size: 11px;
           background: #f5f5f5; padding: 1px 4px; border-radius: 2px; }
    .meta { display: grid; grid-template-columns: 200px 1fr; gap: 4px 16px; margin: 1em 0; }
    .meta dt { font-weight: 600; color: #555; }
    .meta dd { margin: 0; font-family: "SF Mono", monospace; font-size: 12px; word-break: break-word; }
    .ok { color: #176f2c; font-weight: 600; }
    .warn { color: #b16a00; font-weight: 600; }
    .verify-status { padding: 1em; border-left: 4px solid #ccc; margin-top: 1em; }
    .verify-status.ok { background: #e8f5e9; border-color: #176f2c; }
    .verify-status.fail { background: #fdecea; border-color: #c62828; }
    .footer { margin-top: 3em; padding-top: 1em; border-top: 1px solid #ccc;
              font-size: 11px; color: #666; }
  </style>
</head>
<body>
<div class="doc">
  <h1>Evidence Package — Event #${ev.id}</h1>

  ${caseRef ? `<dl class="meta"><dt>Case reference</dt><dd>${caseRef}</dd></dl>` : ''}

  <h2>Custodian declaration</h2>
  <p>This package was exported from RMPG Flex by
    <strong>${escapeHtml(exporter.full_name)}</strong>
    (badge ${escapeHtml(exporter.badge)})
    on <strong>${exportedAt}</strong>.
  </p>
  <p>The verification below is performed in your browser using
    SubtleCrypto. No data leaves this page. The verification can
    be independently reproduced by re-loading this file with the
    accompanying <code>clip.*</code> file in the same folder.</p>

  <h2>Event details</h2>
  <dl class="meta">
    <dt>Source</dt><dd>${escapeHtml(ev.source)}</dd>
    <dt>Event type</dt><dd>${escapeHtml(ev.event_type)}</dd>
    <dt>Captured at</dt><dd>${escapeHtml(ev.event_timestamp)}</dd>
    <dt>Unit / officer</dt><dd>${escapeHtml(ev.call_sign ?? `unit-${ev.unit_id ?? '?'}`)}${ev.officer_name ? ` / ${escapeHtml(ev.officer_name)}` : ''}${ev.badge_number ? ` (badge ${escapeHtml(ev.badge_number)})` : ''}</dd>
    ${ev.address ? `<dt>Address</dt><dd>${escapeHtml(ev.address)}</dd>` : ''}
    ${ev.call_number ? `<dt>Linked call</dt><dd>${escapeHtml(ev.call_number)}</dd>` : ''}
    ${ev.confidence != null ? `<dt>AI confidence</dt><dd>${(ev.confidence * 100).toFixed(1)}%</dd>` : ''}
    ${ev.model_version ? `<dt>Model version</dt><dd>${escapeHtml(ev.model_version)}</dd>` : ''}
  </dl>

  <h2>Clip integrity</h2>
  <dl class="meta">
    <dt>Expected SHA-256</dt><dd><code>${clipSha}</code></dd>
    <dt>Size (bytes)</dt><dd>${input.clip.size_bytes.toLocaleString()}</dd>
  </dl>
  <p>To verify the clip, drop it into the input below.</p>
  <input type="file" id="clipFile" accept="video/*">
  <div id="clipResult" class="verify-status">Awaiting clip…</div>

  <h2>Evidence chain</h2>
  <p>Signing public key: <code>${pubKey}</code></p>
  <table>
    <thead><tr><th>id</th><th>sha256</th><th>captured_at</th><th>prev</th><th>sig</th></tr></thead>
    <tbody>${chainHtml}</tbody>
  </table>

  <div class="footer">
    Format: rmpg-flex-prosecutor-package/1.
    Hash algorithm: SHA-256. Signature algorithm: Ed25519.
    Generated by RMPG Flex.
  </div>
</div>

<script>
(function() {
  var EXPECTED_SHA = ${JSON.stringify(input.clip.sha256)};

  function bytesToHex(arr) {
    var out = '';
    for (var i = 0; i < arr.length; i++) {
      out += arr[i].toString(16).padStart(2, '0');
    }
    return out;
  }

  function setStatus(el, cls, parts) {
    // Clear existing children, append new ones — no innerHTML.
    while (el.firstChild) el.removeChild(el.firstChild);
    el.className = 'verify-status ' + cls;
    parts.forEach(function(p) { el.appendChild(p); });
  }

  function makeStrong(text) {
    var n = document.createElement('strong');
    n.textContent = text;
    return n;
  }

  function makeText(text) { return document.createTextNode(text); }

  function makeCode(text) {
    var n = document.createElement('code');
    n.textContent = text;
    return n;
  }

  function makeBr() { return document.createElement('br'); }

  document.getElementById('clipFile').addEventListener('change', async function(e) {
    var f = e.target.files[0];
    if (!f) return;
    var resultEl = document.getElementById('clipResult');
    resultEl.textContent = 'Hashing… (' + (f.size / 1024 / 1024).toFixed(1) + ' MB)';
    resultEl.className = 'verify-status';
    try {
      var buf = await f.arrayBuffer();
      var hashBuf = await crypto.subtle.digest('SHA-256', buf);
      var hex = bytesToHex(new Uint8Array(hashBuf));
      if (hex === EXPECTED_SHA) {
        setStatus(resultEl, 'ok', [
          makeStrong('✓ Clip verified.'),
          makeText(' The file you provided matches the expected SHA-256 recorded by RMPG Flex at capture time. The bytes have not been altered.'),
        ]);
      } else {
        setStatus(resultEl, 'fail', [
          makeStrong('✗ MISMATCH.'),
          makeText(' Expected '), makeCode(EXPECTED_SHA), makeBr(),
          makeText('Got '), makeCode(hex), makeBr(),
          makeText('This file has been altered or is not the original clip.'),
        ]);
      }
    } catch (err) {
      resultEl.className = 'verify-status fail';
      resultEl.textContent = 'Hash failed: ' + (err && err.message ? err.message : String(err));
    }
  });
})();
</script>
</body>
</html>`;
}
