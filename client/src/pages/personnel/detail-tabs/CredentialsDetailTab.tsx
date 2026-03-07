// ============================================================
// RMPG Flex — Officer Credentials Detail Tab
// ============================================================

import React from 'react';
import { Award, Plus, Edit2, Trash2, Clock, Hash, Building } from 'lucide-react';
import type { Credential } from '../../../types';
import { calcDaysUntilExpiry } from '../utils/personnelFormatters';
import { CREDENTIAL_STATUS_COLORS } from '../utils/personnelConstants';
import { toDisplayLabel } from '../../../utils/formatters';

interface Props {
  credentials: Credential[];
  onAddCredential: (officerId: string) => void;
  onEditCredential: (cred: Credential) => void;
  onDeleteCredential: (credId: string) => void;
  officerId: string;
}

export default function CredentialsDetailTab({
  credentials,
  onAddCredential,
  onEditCredential,
  onDeleteCredential,
  officerId,
}: Props) {
  const validCount = credentials.filter((c) => c.status === 'valid').length;
  const expiringCount = credentials.filter((c) => c.status === 'expiring_soon').length;
  const expiredCount = credentials.filter((c) => c.status === 'expired' || c.status === 'revoked').length;

  const topBorderColor = (status: string) => {
    if (status === 'valid') return 'border-t-2 border-t-green-500';
    if (status === 'expiring_soon') return 'border-t-2 border-t-amber-500';
    return 'border-t-2 border-t-red-500';
  };

  const ledClass = (status: string) => {
    if (status === 'valid') return 'led-dot led-green';
    if (status === 'expiring_soon') return 'led-dot led-amber';
    return 'led-dot led-red';
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="field-label text-brand-400 flex items-center gap-1.5">
          <Award className="w-3 h-3" />
          Credentials
        </h3>
        <button
          onClick={() => onAddCredential(officerId)}
          className="toolbar-btn toolbar-btn-primary flex items-center gap-1 text-[10px]"
        >
          <Plus className="w-3 h-3" />
          Add Credential
        </button>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-green-500">
          <p className="text-lg font-bold text-green-400 font-mono">{validCount}</p>
          <p className="field-label">Valid</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-amber-500">
          <p className="text-lg font-bold text-amber-400 font-mono">{expiringCount}</p>
          <p className="field-label">Expiring</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-red-500">
          <p className="text-lg font-bold text-red-400 font-mono">{expiredCount}</p>
          <p className="field-label">Expired</p>
        </div>
      </div>

      {/* Credential Cards */}
      {credentials.length > 0 ? (
        <div className="space-y-3">
          {credentials.map((cred) => {
            const days = calcDaysUntilExpiry(cred.expiry_date);
            const statusLabel = cred.status.replace('_', ' ').toUpperCase();

            return (
              <div
                key={cred.id}
                className={`panel-beveled p-3 bg-surface-base ${topBorderColor(cred.status)}`}
              >
                {/* Title row */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={ledClass(cred.status)} />
                    <h4 className="text-xs font-semibold text-rmpg-100">{toDisplayLabel(cred.type)}</h4>
                    <span className={`text-[9px] px-1.5 py-0.5 font-bold ${CREDENTIAL_STATUS_COLORS[cred.status] || 'bg-rmpg-700 text-rmpg-300'}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onEditCredential(cred)}
                      className="toolbar-btn p-1"
                      title="Edit credential"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onDeleteCredential(cred.id)}
                      className="toolbar-btn toolbar-btn-danger p-1"
                      title="Delete credential"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Detail grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 mb-2">
                  <div>
                    <p className="field-label">Number</p>
                    <p className="text-xs text-rmpg-100 font-mono">{cred.credential_number || '-'}</p>
                  </div>
                  <div>
                    <p className="field-label">Authority</p>
                    <p className="text-xs text-rmpg-100">{cred.issuing_authority || '-'}</p>
                  </div>
                  <div>
                    <p className="field-label">Issued</p>
                    <p className="text-xs text-rmpg-100 font-mono">{formatDate(cred.issued_date)}</p>
                  </div>
                </div>

                {/* Expiry */}
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="w-3 h-3 text-rmpg-400" />
                  <span className="field-label">Expires:</span>
                  <span className="text-rmpg-100 font-mono">{formatDate(cred.expiry_date)}</span>
                  {days > 0 ? (
                    <span className="text-rmpg-400 font-mono text-[10px]">({days}d remaining)</span>
                  ) : (
                    <span className="text-red-400 font-bold font-mono text-[10px] flex items-center gap-1">
                      <span className="led-dot led-red" />
                      ({Math.abs(days)}d overdue)
                    </span>
                  )}
                </div>

                {/* Notes */}
                {cred.notes && (
                  <div className="panel-inset px-2 py-1.5 mt-2">
                    <p className="text-[10px] text-rmpg-400 italic">
                      {cred.notes}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel-beveled p-8 text-center bg-surface-base">
          <Award className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
          <p className="text-xs text-rmpg-400">No credentials on file</p>
        </div>
      )}
    </div>
  );
}
