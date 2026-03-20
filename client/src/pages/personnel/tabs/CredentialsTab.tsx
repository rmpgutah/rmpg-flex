// ============================================================
// RMPG Flex — Personnel: Credentials Tab (All Credentials)
// ============================================================

import React, { useMemo } from 'react';
import {
  Award, AlertTriangle, CheckCircle, Plus, Edit3, Trash2, ShieldAlert,
} from 'lucide-react';
import type { Credential } from '../../../types';
import { CREDENTIAL_STATUS_COLORS } from '../utils/personnelConstants';
import { toDisplayLabel } from '../../../utils/formatters';

interface Props {
  credentials: Credential[];
  onAddCredential: () => void;
  onEditCredential: (cred: Credential) => void;
  onDeleteCredential: (credId: string) => void;
}

export default function CredentialsTab({ credentials, onAddCredential, onEditCredential, onDeleteCredential }: Props) {
  const stats = useMemo(() => {
    const valid = credentials.filter((c) => c.status === 'valid').length;
    const expiringSoon = credentials.filter((c) => c.status === 'expiring_soon').length;
    const expired = credentials.filter((c) => c.status === 'expired').length;
    return { total: credentials.length, valid, expiringSoon, expired };
  }, [credentials]);

  const alertCount = stats.expiringSoon + stats.expired;

  function formatDate(dateStr?: string): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'valid': return 'Valid';
      case 'expiring_soon': return 'Expiring';
      case 'expired': return 'Expired';
      case 'revoked': return 'Revoked';
      default: return status;
    }
  }

  function StatusIcon({ status }: { status: string }) {
    if (status === 'valid') return <CheckCircle className="w-3 h-3" />;
    return <AlertTriangle className="w-3 h-3" />;
  }

  function statusLedClass(status: string): string {
    switch (status) {
      case 'valid': return 'led-dot led-green';
      case 'expiring_soon': return 'led-dot led-amber';
      case 'expired': return 'led-dot led-red';
      case 'revoked': return 'led-dot led-red';
      default: return 'led-dot led-off';
    }
  }

  const SUMMARY_CARDS = [
    { label: 'Total', value: stats.total, color: 'text-rmpg-300', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-500' },
    { label: 'Valid', value: stats.valid, color: 'text-green-400', bgClass: 'bg-[#0a1a0a]', border: 'border-green-700/30', topBorder: 'border-t-green-500' },
    { label: 'Expiring Soon', value: stats.expiringSoon, color: 'text-amber-400', bgClass: 'bg-[#1a1400]', border: 'border-amber-700/30', topBorder: 'border-t-amber-500' },
    { label: 'Expired', value: stats.expired, color: 'text-red-400', bgClass: 'bg-[#1a0a0a]', border: 'border-red-700/30', topBorder: 'border-t-red-500' },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Fixed Header */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-rmpg-600" style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 section-icon" />
            <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Credentials</h2>
          </div>
          <button onClick={onAddCredential} className="toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
            <Plus className="w-3 h-3" />
            Add Credential
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
      {/* Alert Banner */}
      {alertCount > 0 && (
        <div className="alert-banner alert-banner-critical panel-beveled p-3 flex items-center gap-3 border border-amber-700/40 bg-[#1a1400]" style={{ '--alert-color': '#f59e0b' } as React.CSSProperties}>
          <span className="led-dot led-red flex-shrink-0" />
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-amber-400 font-semibold">
              {alertCount} credential{alertCount !== 1 ? 's' : ''} require{alertCount === 1 ? 's' : ''} attention
            </span>
            <span className="text-[10px] text-amber-500 ml-1.5">
              ({stats.expired} expired, {stats.expiringSoon} expiring soon)
            </span>
          </div>
          <button onClick={onAddCredential} className="toolbar-btn text-[10px] px-2 py-1 text-amber-400 border-amber-700/50">
            <Plus className="w-2.5 h-2.5 inline mr-0.5" />
            Add
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {SUMMARY_CARDS.map((card, i) => (
          <div
            key={card.label}
            className={`stat-pod summary-card-shimmer cascade-item panel-beveled p-2.5 text-center border border-t-2 ${card.border} ${card.bgClass} ${card.topBorder}`}
            style={{ '--pod-glow': card.color.includes('green') ? 'rgba(34,197,94,0.12)' : card.color.includes('amber') ? 'rgba(245,158,11,0.12)' : card.color.includes('red') ? 'rgba(239,68,68,0.12)' : 'rgba(26,90,158,0.12)' } as React.CSSProperties}
          >
            <div className={`stat-value text-sm font-bold font-mono ${card.color}`}>{card.value}</div>
            <div className="stat-label text-[7px] text-rmpg-500 uppercase">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Credentials Table */}
      <div className="personnel-table panel-beveled overflow-x-auto bg-surface-sunken">
        <table className="table-dark w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="text-left">Officer</th>
              <th className="text-left">Type</th>
              <th className="text-left">Number</th>
              <th className="text-left">Authority</th>
              <th className="text-left">Issued</th>
              <th className="text-left">Expires</th>
              <th className="text-left">Status</th>
              <th className="text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {credentials.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8">
                  <div className="empty-state-icon w-16 h-16 mx-auto mb-3 rounded-full border border-rmpg-700/50 flex items-center justify-center bg-surface-sunken">
                    <ShieldAlert className="w-7 h-7 text-rmpg-600" />
                  </div>
                  <p className="text-[11px] text-rmpg-500 font-medium">No credentials found</p>
                  <p className="text-[9px] text-rmpg-600 mt-1">Add credentials to track officer certifications and licenses.</p>
                </td>
              </tr>
            ) : (
              credentials.map((cred) => (
                <tr
                  key={cred.id}
                  className={`group ${cred.status === 'expired' ? 'row-alert' : ''}`}
                >
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className={statusLedClass(cred.status)} />
                      <span className="text-xs text-rmpg-200">{cred.officer_name}</span>
                    </div>
                  </td>
                  <td>
                    <span className="text-xs text-rmpg-300 font-medium">{toDisplayLabel(cred.type)}</span>
                  </td>
                  <td>
                    <span className="text-xs font-mono text-rmpg-400">{cred.credential_number || '-'}</span>
                  </td>
                  <td>
                    <span className="text-xs text-rmpg-400">{cred.issuing_authority || '-'}</span>
                  </td>
                  <td>
                    <span className="text-xs font-mono text-rmpg-400">{formatDate(cred.issued_date)}</span>
                  </td>
                  <td>
                    <span className="text-xs font-mono text-rmpg-400">{formatDate(cred.expiry_date)}</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className={statusLedClass(cred.status)} />
                      <span className={`badge-pill ${
                        CREDENTIAL_STATUS_COLORS[cred.status] || 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600'
                      }`}>
                        <StatusIcon status={cred.status} />
                        {statusLabel(cred.status)}
                      </span>
                    </div>
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        onClick={() => onEditCredential(cred)}
                        className="toolbar-btn p-1"
                        title="Edit credential"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => onDeleteCredential(cred.id)}
                        className="toolbar-btn toolbar-btn-danger p-1"
                        title="Delete credential"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
