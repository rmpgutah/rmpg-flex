// ============================================================
// RMPG Flex — Officer Profile Detail Tab
// ============================================================

import React from 'react';
import {
  User, Phone, Mail, MapPin, Briefcase, Hash, AlertTriangle,
  Heart, Droplet, FileText, Award, Calendar, Paperclip, Radio, Shield,
} from 'lucide-react';
import type { Credential } from '../../../types';
import type { OfficerWithStatus } from '../utils/personnelMappers';
import { calcDaysUntilExpiry } from '../utils/personnelFormatters';
import { toDisplayLabel } from '../../../utils/formatters';
import FileAttachments from '../../../components/FileAttachments';

interface Props {
  officer: OfficerWithStatus;
  credentials: Credential[];
}

function renderInfoRow(
  label: string,
  value: string | undefined | null,
  icon?: React.ReactNode,
) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1">
      {icon && <span className="text-rmpg-400 mt-0.5 flex-shrink-0">{icon}</span>}
      <div className="min-w-0">
        <p className="field-label">{label}</p>
        <p className="text-xs text-rmpg-100 break-words">{value}</p>
      </div>
    </div>
  );
}

export default function ProfileDetailTab({ officer, credentials }: Props) {
  const fullName = [officer.first_name, officer.middle_name, officer.last_name]
    .filter(Boolean)
    .join(' ') || '-';

  const fullAddress = [officer.address, officer.city, officer.state, officer.zip]
    .filter(Boolean)
    .join(', ');

  const formatDate = (d?: string) => {
    if (!d) return undefined;
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const credDotColor = (status: string) => {
    if (status === 'valid') return 'led-dot led-green';
    if (status === 'expiring_soon') return 'led-dot led-amber';
    return 'led-dot led-red';
  };

  // Build OPR identifier: "D-101 #1234 MITCHELL, John" (call_sign + badge + name)
  const oprCallSign = officer.unit_call_sign || null;
  const oprLastName = officer.last_name?.toUpperCase() || '';
  const oprFirstName = officer.first_name || '';
  const oprBadge = officer.badge_number ? `#${officer.badge_number}` : '';
  const oprNamePart = oprLastName && oprFirstName
    ? `${oprLastName}, ${oprFirstName}`
    : oprLastName || oprFirstName || '';
  const oprLabel = [oprCallSign, oprBadge, oprNamePart].filter(Boolean).join(' ') || null;

  return (
    <div className="space-y-4">
      {/* ---- OPR Identifier Banner ---- */}
      <div
        className="panel-beveled p-3 border-l-2 bg-surface-base"
        style={{ borderLeftColor: '#d4a017' }}
      >
        <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-2 mb-3">
          <Radio className="w-3 h-3" />
          Operator Identification
        </h3>
        <div className="grid grid-cols-3 gap-x-6 gap-y-1">
          <div className="flex items-start gap-2 py-1 col-span-2">
            <span className="text-rmpg-400 mt-0.5 flex-shrink-0"><Shield className="w-3 h-3" /></span>
            <div className="min-w-0">
              <p className="field-label">OPR</p>
              {oprLabel ? (
                <p className="text-sm font-bold font-mono tracking-wide text-amber-400">{oprLabel}</p>
              ) : (
                <p className="text-xs text-rmpg-500 italic">No unit assigned</p>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2 py-1">
            <span className="text-rmpg-400 mt-0.5 flex-shrink-0"><Hash className="w-3 h-3" /></span>
            <div className="min-w-0">
              <p className="field-label">Badge Number</p>
              {officer.badge_number ? (
                <p className="text-sm font-bold font-mono tracking-wide text-rmpg-100">{officer.badge_number}</p>
              ) : (
                <p className="text-xs text-rmpg-500 italic">Not assigned</p>
              )}
            </div>
          </div>
          {oprCallSign && (
            <div className="flex items-start gap-2 py-1">
              <span className="text-rmpg-400 mt-0.5 flex-shrink-0"><Radio className="w-3 h-3" /></span>
              <div className="min-w-0">
                <p className="field-label">Unit Call Sign</p>
                <p className="text-xs text-rmpg-100 font-mono">{oprCallSign}</p>
              </div>
            </div>
          )}
          {renderInfoRow('Rank', officer.rank)}
          {renderInfoRow('Role', officer.role?.toUpperCase())}
        </div>
      </div>

      {/* ---- Personal Information ---- */}
      <div className="panel-beveled p-3 bg-surface-base">
        <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-2 mb-3">
          <User className="w-3 h-3" />
          Personal Information
        </h3>
        <div className="grid grid-cols-3 gap-x-6 gap-y-1">
          {renderInfoRow('Full Name', fullName)}
          {renderInfoRow('Date of Birth', formatDate(officer.date_of_birth), <Calendar className="w-3 h-3" />)}
          {renderInfoRow('Department', officer.department, <Briefcase className="w-3 h-3" />)}
          {renderInfoRow('Hire Date', formatDate(officer.hire_date), <Calendar className="w-3 h-3" />)}
          {renderInfoRow('Shift Preference', officer.shift_preference)}
          {renderInfoRow('Username', officer.username, <Hash className="w-3 h-3" />)}
        </div>
      </div>

      {/* ---- Contact Information ---- */}
      <div className="panel-beveled p-3 bg-surface-base">
        <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-2 mb-3">
          <Phone className="w-3 h-3" />
          Contact Information
        </h3>
        <div className="grid grid-cols-3 gap-x-6 gap-y-1">
          {renderInfoRow('Phone', officer.phone, <Phone className="w-3 h-3" />)}
          {renderInfoRow('Email', officer.email, <Mail className="w-3 h-3" />)}
          {renderInfoRow('Address', fullAddress || undefined, <MapPin className="w-3 h-3" />)}
        </div>
      </div>

      {/* ---- Emergency Contact ---- */}
      <div className="panel-beveled p-3 border-l-2 border-l-red-600 bg-surface-base">
        <h3 className="field-label text-red-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-2 mb-3">
          <AlertTriangle className="w-3 h-3" />
          Emergency Contact
        </h3>
        {officer.emergency_contact_name ? (
          <div className="grid grid-cols-3 gap-x-6 gap-y-1">
            {renderInfoRow('Name', officer.emergency_contact_name)}
            {renderInfoRow('Phone', officer.emergency_contact_phone, <Phone className="w-3 h-3" />)}
            {renderInfoRow('Relationship', officer.emergency_contact_relationship)}
          </div>
        ) : (
          <p className="text-xs text-rmpg-400 italic">No emergency contact on file</p>
        )}
      </div>

      {/* ---- Medical & Safety ---- */}
      <div className="panel-beveled p-3 bg-surface-base">
        <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-2 mb-3">
          <Heart className="w-3 h-3" />
          Medical &amp; Safety
        </h3>
        <div className="grid grid-cols-3 gap-x-6 gap-y-1">
          {renderInfoRow('Blood Type', officer.blood_type, <Droplet className="w-3 h-3" />)}
          {renderInfoRow('Allergies', officer.allergies)}
          {renderInfoRow('Uniform Size', officer.uniform_size)}
        </div>
      </div>

      {/* ---- Driver's License ---- */}
      {officer.dl_number && (
        <div className="panel-beveled p-3 bg-surface-base">
          <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-2 mb-3">
            <FileText className="w-3 h-3" />
            Driver&apos;s License
          </h3>
          <div className="grid grid-cols-3 gap-x-6 gap-y-1">
            {renderInfoRow('DL Number', officer.dl_number)}
            {renderInfoRow('State', officer.dl_state)}
            {renderInfoRow('Expiry', formatDate(officer.dl_expiry))}
          </div>
        </div>
      )}

      {/* ---- Credential Summary ---- */}
      <div className="panel-beveled p-3 bg-surface-base">
        <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-2 mb-3">
          <Award className="w-3 h-3" />
          Credential Summary
        </h3>
        {credentials.length > 0 ? (
          <div className="space-y-1.5">
            {credentials.map((cred) => {
              const days = calcDaysUntilExpiry(cred.expiry_date);
              return (
                <div key={cred.id} className="flex items-center gap-2 text-xs">
                  <span className={credDotColor(cred.status)} />
                  <span className="text-rmpg-100 flex-1 truncate">{toDisplayLabel(cred.type)}</span>
                  <span className="text-rmpg-400 text-[10px] font-mono">
                    {days > 0
                      ? `${new Date(cred.expiry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                      : 'Expired'}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-rmpg-400 italic">No credentials on file</p>
        )}
      </div>

      {/* ---- Personnel Files ---- */}
      <div className="panel-beveled p-3 bg-surface-base">
        <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-2 mb-3">
          <Paperclip className="w-3 h-3" />
          Personnel Files
        </h3>
        <FileAttachments entityType="personnel" entityId={officer.id} />
      </div>
    </div>
  );
}
