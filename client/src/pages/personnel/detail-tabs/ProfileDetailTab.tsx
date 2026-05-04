// ============================================================
// RMPG Flex — Officer Profile Detail Tab (Spillman 3-Column Dense Layout)
// Matches Spillman Flex Personnel/Employee screen:
//   Left column: Photo + Identity | Center: Employment | Right: Contact
// ============================================================

import {
  User, Phone, Mail, MapPin, Briefcase, Hash, AlertTriangle,
  Heart, Droplet, FileText, Award, Calendar, Paperclip, Radio, Shield,
  Car,
} from 'lucide-react';
import type { Credential } from '../../../types';
import type { OfficerWithStatus } from '../utils/personnelMappers';
import { calcDaysUntilExpiry } from '../utils/personnelFormatters';
import { toDisplayLabel } from '../../../utils/formatters';
import FileAttachments from '../../../components/FileAttachments';
import OfficerAvatar from '../components/OfficerAvatar';

interface Props {
  officer: OfficerWithStatus;
  credentials: Credential[];
}

/** Field row — gold label above value, with breathing room */
function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="py-1">
      <p className="field-label">{label}</p>
      <p className={`text-[11px] ${mono ? 'font-mono' : ''} ${value ? 'text-rmpg-100' : 'text-rmpg-600 italic'} break-words leading-snug mt-0.5`}>
        {value || '—'}
      </p>
    </div>
  );
}

export default function ProfileDetailTab({ officer, credentials }: Props) {
  const fullName = [officer.first_name, officer.middle_name, officer.last_name]
    .filter(Boolean)
    .join(' ') || '-';

  const formatDate = (d?: string) => {
    if (!d) return undefined;
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const credDotColor = (status: string) => {
    if (status === 'valid') return 'led-dot led-green';
    if (status === 'expiring_soon') return 'led-dot led-amber';
    return 'led-dot led-red';
  };

  // OPR identifier
  const oprCallSign = officer.unit_call_sign || null;
  const oprLastName = officer.last_name?.toUpperCase() || '';
  const oprFirstName = officer.first_name || '';
  const oprBadge = officer.badge_number ? `#${officer.badge_number}` : '';
  const oprNamePart = oprLastName && oprFirstName
    ? `${oprLastName}, ${oprFirstName}`
    : oprLastName || oprFirstName || '';
  const oprLabel = [oprCallSign, oprBadge, oprNamePart].filter(Boolean).join(' ') || null;

  return (
    <div className="space-y-2">
      {/* 3-Column Layout — Identity / Employment / Contact */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">

        {/* ── LEFT COLUMN: Photo + Core Identity ── */}
        <div className="panel-beveled p-3 bg-surface-base space-y-3">
          {/* Photo area */}
          <div className="flex justify-center">
            <OfficerAvatar officer={officer} size="lg" />
          </div>

          {/* Section header */}
          <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-1">
            <User className="w-3 h-3" />
            Identity
          </h3>

          <div className="space-y-0">
            <Field label="Full Name" value={fullName} />
            <Field label="Badge Number" value={officer.badge_number} mono />
            <Field label="Call Sign" value={officer.unit_call_sign} mono />
            <Field label="Date of Birth" value={formatDate(officer.date_of_birth)} />
            <Field label="Username" value={officer.username} mono />
          </div>

          {/* Medical section nested in left column */}
          <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-1 pt-1">
            <Heart className="w-3 h-3" />
            Medical
          </h3>
          <div className="space-y-0">
            <Field label="Blood Type" value={officer.blood_type} />
            <Field label="Allergies" value={officer.allergies} />
            <Field label="Uniform Size" value={officer.uniform_size} />
          </div>
        </div>

        {/* ── CENTER COLUMN: Employment Details ── */}
        <div className="panel-beveled p-3 bg-surface-base space-y-3">
          <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-1">
            <Briefcase className="w-3 h-3" />
            Employment
          </h3>

          <div className="space-y-0">
            <Field label="Rank" value={officer.rank} />
            <Field label="Role" value={officer.role ? toDisplayLabel(officer.role) : undefined} />
            <Field label="Department" value={officer.department} />
            <Field label="Hire Date" value={formatDate(officer.hire_date)} />
            <Field label="Termination Date" value={formatDate(officer.termination_date)} />
            <Field label="Shift Preference" value={officer.shift_preference} />
          </div>

          {/* Driver's License */}
          <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-1 pt-1">
            <Car className="w-3 h-3" />
            Driver&apos;s License
          </h3>
          <div className="space-y-0">
            <Field label="DL Number" value={officer.dl_number} mono />
            <Field label="State" value={officer.dl_state} />
            <Field label="Expiry" value={formatDate(officer.dl_expiry)} />
          </div>

          {/* Credential Summary */}
          <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-1 pt-1">
            <Award className="w-3 h-3" />
            Credentials ({credentials.length})
          </h3>
          {credentials.length > 0 ? (
            <div className="space-y-1">
              {credentials.map((cred) => {
                const days = calcDaysUntilExpiry(cred.expiry_date);
                return (
                  <div key={cred.id} className="flex items-center gap-1.5 text-[10px]">
                    <span className={credDotColor(cred.status)} />
                    <span className="text-rmpg-100 flex-1 truncate">{toDisplayLabel(cred.type)}</span>
                    <span className="text-rmpg-400 font-mono">
                      {days > 0
                        ? new Date(cred.expiry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                        : 'EXP'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] text-rmpg-400 italic">None on file</p>
          )}
        </div>

        {/* ── RIGHT COLUMN: Contact + Emergency ── */}
        <div className="panel-beveled p-3 bg-surface-base space-y-3">
          <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-1">
            <Phone className="w-3 h-3" />
            Contact
          </h3>

          <div className="space-y-0">
            <Field label="Phone" value={officer.phone} mono />
            <Field label="Email" value={officer.email} />
            <Field label="Address" value={officer.address} />
            <Field label="City" value={officer.city} />
            <Field label="State / Zip" value={[officer.state, officer.zip].filter(Boolean).join(' ') || undefined} />
          </div>

          {/* Emergency Contact */}
          <h3 className="field-label text-red-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-1 pt-1">
            <AlertTriangle className="w-3 h-3" />
            Emergency Contact
          </h3>
          {officer.emergency_contact_name ? (
            <div className="space-y-0">
              <Field label="Name" value={officer.emergency_contact_name} />
              <Field label="Phone" value={officer.emergency_contact_phone} mono />
              <Field label="Relationship" value={officer.emergency_contact_relationship} />
            </div>
          ) : (
            <p className="text-[10px] text-rmpg-500 italic">Not on file</p>
          )}

          {/* Personnel Files */}
          <h3 className="field-label text-brand-400 flex items-center gap-1.5 border-b border-rmpg-700 pb-1 pt-1">
            <Paperclip className="w-3 h-3" />
            Personnel Files
          </h3>
          <FileAttachments entityType="personnel" entityId={officer.id} />
        </div>
      </div>
    </div>
  );
}
