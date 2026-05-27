// ============================================================
// AdminEvidenceTab — Phase 4 chain-of-custody dashboard
// ============================================================
// Surfaces the JSON-only /api/evidence/* endpoints in a
// supervisor/IA-friendly UI. Three sections:
//
//   1. Keypair status        — is signing configured? show pubkey
//                              for distribution to DA's office.
//   2. Chain integrity audit — per-artifact-type chain check;
//                              counts of signed/unsigned/tampered.
//   3. Recent events         — quick links to per-event manifest,
//                              verifier HTML, and clip download.
//
// Read-only by design — Phase 4 SOP requires evidence operations
// (export, key rotation) to be deliberate, not one-click. This
// page is for situational awareness; the actions go through
// documented procedures in docs/evidence-handling-sop.md.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, ShieldCheck, ShieldAlert, Key, Eye, EyeOff, Copy, CheckCircle2,
  XCircle, AlertTriangle, RefreshCw, FileText, Download, ExternalLink,
  Clock, Hash,
} from 'lucide-react';
import { apiFetch, authedImageUrl } from '../../hooks/useApi';
import { asArray } from '../../utils/asArray';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface KeypairInfo {
  configured: boolean;
  algorithm: string;
  public_key: string | null;
  message: string;
}

interface ChainAudit {
  artifact_type: string;
  ok: boolean;
  checked: number;
  broken_at_id: number | null;
  signatures_verified?: number;
  unsigned_count?: number;
  signature_failure?: boolean;
}

interface AuditResponse {
  signing_configured: boolean;
  all_chains_ok: boolean;
  any_signature_failure: boolean;
  any_unsigned: boolean;
  total_entries: number;
  audits: ChainAudit[];
}

interface RecentEvent {
  id: number;
  source: string;
  event_type: string;
  severity: string;
  event_timestamp: string;
  has_video: number;
  call_sign: string | null;
  officer_name: string | null;
}

export default function AdminEvidenceTab({ LoadingSpinner, error, setError }: Props): React.ReactElement {
  const [keypair, setKeypair] = useState<KeypairInfo | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPublicKey, setShowPublicKey] = useState(false);
  const [copied, setCopied] = useState<'pubkey' | 'curl' | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kpRes, auditRes, recentRes] = await Promise.all([
        apiFetch<KeypairInfo>('/api/evidence/keypair-info'),
        apiFetch<AuditResponse>('/api/evidence/audit'),
        apiFetch<{ events: RecentEvent[] }>('/api/driving-events?has_video=1&limit=20').catch(() => ({ events: [] })),
      ]);
      setKeypair(kpRes);
      setAudit(auditRes);
      setRecent(asArray<RecentEvent>(recentRes?.events));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load evidence audit');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCopy = (key: 'pubkey' | 'curl', value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const overallStatusColor = !keypair?.configured
    ? 'border-amber-700 bg-amber-900/20 text-amber-300'
    : audit?.any_signature_failure
      ? 'border-red-600 bg-red-900/30 text-red-200'
      : audit?.any_unsigned
        ? 'border-amber-700 bg-amber-900/20 text-amber-300'
        : 'border-green-700 bg-green-900/20 text-green-300';

  const overallStatusIcon = !keypair?.configured
    ? AlertTriangle
    : audit?.any_signature_failure
      ? ShieldAlert
      : audit?.any_unsigned
        ? AlertTriangle
        : ShieldCheck;
  const StatusIcon = overallStatusIcon;

  const overallStatusText = !keypair?.configured
    ? 'Evidence signing is NOT configured. New evidence rows are unsigned.'
    : audit?.any_signature_failure
      ? 'CHAIN TAMPER DETECTED — at least one signed entry has been altered. See SOP §8.'
      : audit?.any_unsigned
        ? 'Some evidence entries are unsigned (legacy or pre-signing). Chain links intact.'
        : `All chains intact. ${audit?.total_entries ?? 0} entries verified.`;

  return (
    <div className="space-y-4 p-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-rmpg-100 flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#d4a017]" aria-hidden="true" />
            Evidence Chain Audit
          </h2>
          <p className="text-[11px] text-rmpg-400 mt-1">
            Phase 4 — chain-of-custody integrity for dashcam-AI evidence.
            Read-only dashboard; export operations follow documented SOP.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#222] hover:border-[#d4a017] hover:text-[#d4a017] disabled:opacity-50 text-[11px]"
          type="button"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="border border-red-700 bg-red-900/30 text-red-200 p-3 text-[11px] flex items-start gap-2">
          <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>{error}</div>
        </div>
      )}

      {loading && !keypair && <LoadingSpinner />}

      {/* Overall status banner */}
      {keypair && audit && (
        <div className={`border-l-4 p-3 text-[12px] flex items-start gap-2 ${overallStatusColor}`}>
          <StatusIcon className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <div className="font-semibold">{overallStatusText}</div>
            <div className="text-[11px] mt-0.5 opacity-80">
              See <code className="text-[#d4a017]">docs/evidence-handling-sop.md</code> §7 (verifying integrity), §8 (incident response).
            </div>
          </div>
        </div>
      )}

      {/* Section 1: Keypair status */}
      {keypair && (
        <div className="border border-[#222] bg-surface-raised">
          <div className="px-3 py-2 border-b border-[#222] bg-surface-base text-[10px] uppercase tracking-wider text-rmpg-400 font-semibold flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5" aria-hidden="true" /> Signing Keypair
          </div>
          <div className="p-3 space-y-2 text-[11px]">
            <div className="flex items-center gap-2">
              {keypair.configured ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
              )}
              <span className={keypair.configured ? 'text-green-300' : 'text-amber-300'}>
                {keypair.configured ? 'Configured' : 'NOT configured'}
              </span>
              <span className="text-rmpg-500">— Algorithm: <span className="font-mono text-rmpg-300">{keypair.algorithm}</span></span>
            </div>
            <div className="text-rmpg-400 text-[10px]">{keypair.message}</div>

            {keypair.public_key && (
              <div className="mt-2">
                <div className="text-[10px] uppercase tracking-wider text-rmpg-500 mb-1">
                  Public key (distribute to DA's office for verification)
                </div>
                <div className="flex items-stretch gap-2">
                  <div
                    className="flex-1 bg-surface-sunken border border-[#222] p-2 text-[10px] font-mono break-all max-h-20 overflow-auto"
                    title={showPublicKey ? '' : 'Click to reveal'}
                  >
                    {showPublicKey ? keypair.public_key : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => setShowPublicKey(s => !s)}
                      className="px-2 py-1 border border-[#222] hover:border-[#d4a017] hover:text-[#d4a017] text-[10px]"
                      aria-label={showPublicKey ? 'Hide public key' : 'Show public key'}
                    >
                      {showPublicKey ? <EyeOff className="w-3 h-3" aria-hidden="true" /> : <Eye className="w-3 h-3" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy('pubkey', keypair.public_key!)}
                      className="px-2 py-1 border border-[#222] hover:border-[#d4a017] hover:text-[#d4a017] text-[10px]"
                      aria-label="Copy public key"
                    >
                      {copied === 'pubkey' ? <CheckCircle2 className="w-3 h-3 text-green-400" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!keypair.configured && (
              <div className="mt-2 p-2 border border-amber-700/40 bg-amber-900/10 text-[10px] text-amber-200">
                <div className="font-semibold mb-1">To enable signing:</div>
                <code className="block bg-surface-sunken p-1.5 text-[10px]">node server/scripts/generate-evidence-keypair.mjs</code>
                <div className="mt-1">Append the output to <code className="text-[#d4a017]">server/.env</code> on the VPS and restart the service. New evidence rows will be signed; older rows stay unsigned (audit will flag them).</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 2: Chain audit */}
      {audit && (
        <div className="border border-[#222] bg-surface-raised">
          <div className="px-3 py-2 border-b border-[#222] bg-surface-base text-[10px] uppercase tracking-wider text-rmpg-400 font-semibold flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5" aria-hidden="true" /> Chain integrity by artifact type
          </div>
          <div className="p-3">
            {audit.audits.length === 0 ? (
              <div className="text-[11px] text-rmpg-500 italic">
                No evidence_hashes entries yet. Audit will populate once events with clips arrive.
              </div>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="text-[10px] uppercase tracking-wider text-rmpg-400 border-b border-[#222]">
                  <tr>
                    <th className="text-left py-1.5 px-2">Type</th>
                    <th className="text-right py-1.5 px-2">Entries</th>
                    <th className="text-right py-1.5 px-2">Signatures verified</th>
                    <th className="text-right py-1.5 px-2">Unsigned</th>
                    <th className="text-center py-1.5 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {asArray<ChainAudit>(audit.audits).map(a => (
                    <tr key={a.artifact_type} className="border-b border-[#1a1a1a]">
                      <td className="py-1.5 px-2 font-mono">{a.artifact_type}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{a.checked}</td>
                      <td className="py-1.5 px-2 text-right font-mono">
                        {a.signatures_verified != null ? (
                          <span className={a.signatures_verified === a.checked ? 'text-green-400' : 'text-amber-400'}>
                            {a.signatures_verified}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono">
                        {a.unsigned_count != null && a.unsigned_count > 0 ? (
                          <span className="text-amber-400">{a.unsigned_count}</span>
                        ) : (a.unsigned_count ?? '—')}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {a.signature_failure ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono uppercase border border-red-600 text-red-300 bg-red-900/30">
                            <ShieldAlert className="w-3 h-3" aria-hidden="true" /> TAMPER
                          </span>
                        ) : !a.ok ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono uppercase border border-amber-600 text-amber-300 bg-amber-900/30">
                            <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Issue
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono uppercase border border-green-700 text-green-400 bg-green-900/20">
                            <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Section 3: Recent events with export links */}
      <div className="border border-[#222] bg-surface-raised">
        <div className="px-3 py-2 border-b border-[#222] bg-surface-base text-[10px] uppercase tracking-wider text-rmpg-400 font-semibold flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" /> Recent events with video (last 20)
        </div>
        <div className="p-3">
          {recent.length === 0 ? (
            <div className="text-[11px] text-rmpg-500 italic">
              No events with video yet. The dashcam-AI ingest endpoint accepts events when{' '}
              <code className="text-[#d4a017]">DASHCAM_FORWARD_SECRET</code> is configured.
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-rmpg-400 border-b border-[#222]">
                <tr>
                  <th className="text-left py-1.5 px-2">Time</th>
                  <th className="text-left py-1.5 px-2">Unit</th>
                  <th className="text-left py-1.5 px-2">Type</th>
                  <th className="text-left py-1.5 px-2">Severity</th>
                  <th className="text-right py-1.5 px-2">Export package</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(e => (
                  <tr key={e.id} className="border-b border-[#1a1a1a]">
                    <td className="py-1.5 px-2 font-mono text-rmpg-300">{e.event_timestamp}</td>
                    <td className="py-1.5 px-2 font-mono text-[#d4a017]">{e.call_sign ?? '—'}</td>
                    <td className="py-1.5 px-2 font-mono">{e.event_type}</td>
                    <td className="py-1.5 px-2 font-mono">{e.severity}</td>
                    <td className="py-1.5 px-2 text-right">
                      <div className="inline-flex gap-1">
                        <a
                          href={authedImageUrl(`/api/evidence/${e.id}/manifest.json`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-[#222] hover:border-[#d4a017] hover:text-[#d4a017] text-[10px]"
                          aria-label={`Download manifest for event ${e.id}`}
                        >
                          <FileText className="w-3 h-3" aria-hidden="true" /> Manifest
                        </a>
                        <a
                          href={authedImageUrl(`/api/evidence/${e.id}/verify.html`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-[#222] hover:border-[#d4a017] hover:text-[#d4a017] text-[10px]"
                          aria-label={`Open verifier for event ${e.id}`}
                        >
                          <ExternalLink className="w-3 h-3" aria-hidden="true" /> Verify
                        </a>
                        <a
                          href={authedImageUrl(`/api/evidence/${e.id}/clip`)}
                          download
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-[#222] hover:border-[#d4a017] hover:text-[#d4a017] text-[10px]"
                          aria-label={`Download clip for event ${e.id}`}
                        >
                          <Download className="w-3 h-3" aria-hidden="true" /> Clip
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="text-[10px] text-rmpg-500 italic">
        Tip: a complete prosecutor package is the three downloads above for a given event, placed in a folder named after the case reference. See{' '}
        <code className="text-[#d4a017]">docs/evidence-handling-sop.md</code> §6.
      </div>
    </div>
  );
}
