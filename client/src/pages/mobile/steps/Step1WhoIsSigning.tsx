// Step 1 — Who Is Signing
//
// Determines who is at the door and drives variant resolution. Shows:
//   - Read-only context panel (case caption, server, address)
//   - "Signing does not mean you agree" notice
//   - Yes/No question for individual parties ("Are you [name]?")
//   - Role questions when signer is not the named party
//     (premises type, resides/authorized checkboxes, relationship, business fields)

import { Check } from 'lucide-react';

const RELATIONSHIPS = [
  'Spouse', 'Parent', 'Adult child', 'Sibling', 'Roommate / co-resident',
  'Employee', 'Manager / supervisor', 'Registered agent', 'Other',
];

// ── Shared micro-components (private to this step) ────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
      {children}
    </p>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-wider text-gray-400">{label}</span>
      <span className="block text-[14px] text-white leading-snug mt-0.5 whitespace-pre-line">{value || '—'}</span>
    </div>
  );
}

function YesNoButtons({
  label, value, onChange,
}: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div>
      <p className="text-[15px] text-gray-200 mb-3 leading-relaxed font-medium">{label}</p>
      <div className="flex gap-3">
        {([['Yes', true], ['No', false]] as const).map(([txt, val]) => (
          <button
            key={txt}
            type="button"
            onClick={() => onChange(val)}
            className={`flex-1 py-3.5 rounded-sm border-2 text-[15px] font-semibold transition-colors ${
              value === val
                ? 'border-blue-500 bg-blue-900 text-blue-300'
                : 'border-gray-600 bg-transparent text-gray-300'
            }`}
          >
            {txt}
          </button>
        ))}
      </div>
    </div>
  );
}

function PremisesButton({
  label, selected, onClick,
}: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-3 rounded-sm border-2 text-[13px] font-medium capitalize transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-900 text-blue-300'
          : 'border-gray-600 bg-transparent text-gray-300'
      }`}
    >
      {label}
    </button>
  );
}

function CheckRow({
  checked, onChange, children,
}: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="w-full flex items-start gap-3 text-left p-3 rounded-sm bg-gray-50 border border-gray-700 active:opacity-80"
    >
      <span
        className={`mt-0.5 shrink-0 w-5 h-5 rounded-sm border-2 flex items-center justify-center transition-colors ${
          checked ? 'bg-blue-600 border-blue-600' : 'border-gray-500 bg-transparent'
        }`}
        aria-hidden
      >
        {checked && <Check size={13} className="text-white" />}
      </span>
      <span className="text-[14px] leading-relaxed text-gray-200">{children}</span>
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[12px] font-medium text-gray-500 uppercase tracking-wider mb-1">
      {children}
    </span>
  );
}

const inputCls =
  'w-full bg-white border border-gray-600 rounded-sm px-3 py-2.5 ' +
  'text-[15px] text-white placeholder:text-gray-500 focus:outline-none ' +
  'focus:border-blue-400';

// ── Props ─────────────────────────────────────────────────────────────

export interface Step1Props {
  // Case context (read-only)
  plaintiffName: string | null;
  defendantName: string | null;
  addressLine: string;
  serverName: string | null;
  serverBadge: string | null;
  agency: string;

  // Named-party identification
  namedParty: string;
  partyIsEntity: boolean;
  isNamedParty: boolean | null;
  setIsNamedParty: (v: boolean) => void;

  // Role questions
  premisesType: 'residence' | 'business' | 'other';
  setPremisesType: (v: 'residence' | 'business' | 'other') => void;
  residesAtAddress: boolean;
  setResidesAtAddress: (v: boolean) => void;
  authorizedAgent: boolean;
  setAuthorizedAgent: (v: boolean) => void;
  relationship: string;
  setRelationship: (v: string) => void;
  businessName: string;
  setBusinessName: (v: string) => void;
  jobTitle: string;
  setJobTitle: (v: string) => void;
  expectedDelivery: string;
  setExpectedDelivery: (v: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────

export default function Step1WhoIsSigning({
  plaintiffName, defendantName, addressLine, serverName, serverBadge, agency,
  namedParty, partyIsEntity, isNamedParty, setIsNamedParty,
  premisesType, setPremisesType, residesAtAddress, setResidesAtAddress,
  authorizedAgent, setAuthorizedAgent, relationship, setRelationship,
  businessName, setBusinessName, jobTitle, setJobTitle,
  expectedDelivery, setExpectedDelivery,
}: Step1Props) {
  const showRoleQuestions = partyIsEntity || isNamedParty === false;

  return (
    <div className="p-4 pb-6 max-w-lg mx-auto space-y-5">
      {/* ── Agency label ───────────────────────────────────── */}
      <p className="text-[11px] uppercase tracking-widest text-gray-400 text-center">{agency}</p>

      {/* ── "Signing does not mean you agree" notice ────────── */}
      <div className="p-4 rounded-sm border-2 border-blue-800 bg-blue-900">
        <p className="text-[15px] text-gray-100 leading-relaxed">
          <strong>Signing below only confirms that you received these papers.</strong>{' '}
          It is not an admission, not an agreement with anything in the documents, and
          does not give up any of your rights or deadlines to respond.
        </p>
      </div>

      {/* ── Case context panel ──────────────────────────────── */}
      <div className="bg-gray-50 rounded-sm border border-gray-700 p-4 space-y-3">
        <SectionTitle>Case information</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <InfoRow label="Plaintiff / Petitioner" value={plaintiffName} />
          <InfoRow label="Defendant / Respondent" value={defendantName} />
        </div>
        <InfoRow label="Address of service" value={addressLine} />
        {serverName && (
          <InfoRow
            label="Served by"
            value={serverName + (serverBadge ? ` · Badge ${serverBadge}` : '')}
          />
        )}
      </div>

      {/* ── Named-party question ────────────────────────────── */}
      <div className="space-y-4">
        {partyIsEntity ? (
          // The named party is a company — the "Are you…?" question would
          // invite the exact error we are guarding against: a registered
          // agent answering Yes and being recorded as the company itself.
          <div className="p-3 rounded-sm bg-amber-900 border border-amber-700">
            <p className="text-[13px] font-semibold text-amber-300 mb-0.5">Signing for a business</p>
            <p className="text-[13px] text-amber-400 leading-snug">
              The papers are directed at <strong>{namedParty}</strong> — a business or organization.
              You are accepting on its behalf. Please tell us your role below.
            </p>
          </div>
        ) : (
          <YesNoButtons
            label={`Are you ${namedParty}?`}
            value={isNamedParty}
            onChange={setIsNamedParty}
          />
        )}

        {/* ── Role questions ─────────────────────────────────── */}
        {showRoleQuestions && (
          <div className="space-y-4">
            {/* Premises type */}
            <div>
              <FieldLabel>This address is a</FieldLabel>
              <div className="flex gap-2">
                {(['residence', 'business', 'other'] as const).map((t) => (
                  <PremisesButton
                    key={t}
                    label={t}
                    selected={premisesType === t}
                    onClick={() => setPremisesType(t)}
                  />
                ))}
              </div>
            </div>

            {/* Resides / authorized checkboxes */}
            <CheckRow checked={residesAtAddress} onChange={setResidesAtAddress}>
              I live at this address.
            </CheckRow>
            <CheckRow checked={authorizedAgent} onChange={setAuthorizedAgent}>
              I am authorized to accept legal papers at this address (for example,
              a registered agent, an office manager, or a manager on duty).
            </CheckRow>

            {/* Business fields — only when premises type = Business */}
            {premisesType === 'business' && (
              <>
                <div>
                  <FieldLabel>Business name</FieldLabel>
                  <input
                    className={inputCls}
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Legal name of the business"
                    autoComplete="organization"
                  />
                </div>
                <div>
                  <FieldLabel>Your job title (optional)</FieldLabel>
                  <input
                    className={inputCls}
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="e.g. Office Manager"
                    autoComplete="organization-title"
                  />
                </div>
              </>
            )}

            {/* Relationship dropdown */}
            <div>
              <FieldLabel>Your relationship to {namedParty} (optional)</FieldLabel>
              <select
                className={inputCls}
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
              >
                <option value="">Select…</option>
                {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Expected delivery — optional */}
            <div>
              <FieldLabel>When do you expect to hand the documents over? (optional)</FieldLabel>
              <input
                type="date"
                className={inputCls}
                value={expectedDelivery}
                onChange={(e) => setExpectedDelivery(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
