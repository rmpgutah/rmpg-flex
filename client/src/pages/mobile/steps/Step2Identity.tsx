// Step 2 — Your Identity
//
// Three mutually-exclusive ID capture cards:
//   Card A: Scan PDF417 barcode (auto-fills name + description)
//   Card B: Take a photo of the ID front (and optionally back)
//   Card C: Enter ID details manually
//
// Exactly one must be completed before Continue is enabled.
// Name field is always required regardless of which card is used.
// Address confirmation shown once any ID method is completed.

import { Check, ScanLine, Camera, Pencil } from 'lucide-react';

// ── Shared micro-components ───────────────────────────────────────────

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[12px] font-medium text-gray-500 uppercase tracking-wider mb-1">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </span>
  );
}

const inputCls =
  'w-full bg-white border border-gray-600 rounded-sm px-3 py-2.5 ' +
  'text-[15px] text-white placeholder:text-gray-500 focus:outline-none ' +
  'focus:border-blue-400';

const selectCls = inputCls;

// ── Props ─────────────────────────────────────────────────────────────

export interface Step2Props {
  // Name (always editable, required)
  recipientName: string;
  setRecipientName: (v: string) => void;

  // ID scanning state
  idScanning: boolean;
  idScanError: string | null;
  idVerified: boolean;
  idDescription: string;
  idScanMethod: 'barcode' | 'photo' | 'manual' | null;

  // Photo state
  idFrontImage: string | null;
  idBackImage: string | null;

  // Manual entry fields
  manualFirstName: string; setManualFirstName: (v: string) => void;
  manualLastName: string; setManualLastName: (v: string) => void;
  manualMiddleName: string; setManualMiddleName: (v: string) => void;
  manualDob: string; setManualDob: (v: string) => void;
  manualDlNumber: string; setManualDlNumber: (v: string) => void;
  manualDlState: string; setManualDlState: (v: string) => void;
  manualGender: string; setManualGender: (v: string) => void;
  manualHeight: string; setManualHeight: (v: string) => void;
  manualWeight: string; setManualWeight: (v: string) => void;
  manualEyeColor: string; setManualEyeColor: (v: string) => void;
  manualHairColor: string; setManualHairColor: (v: string) => void;

  // Address confirmation
  hasServiceAddress: boolean;
  addressCurrent: boolean;
  setAddressCurrent: (v: boolean) => void;
  currentAddress: string; setCurrentAddress: (v: string) => void;
  currentCity: string; setCurrentCity: (v: string) => void;
  currentState: string; setCurrentState: (v: string) => void;
  currentZip: string; setCurrentZip: (v: string) => void;

  // Handlers (lifted to controller so callbacks stay stable)
  onScanId: (file: File) => Promise<void>;
  onCapturePhoto: (file: File, side: 'front' | 'back') => void;
  onCompleteManual: () => void;

  // Active card selection
  activeCard: 'barcode' | 'photo' | 'manual' | null;
  setActiveCard: (v: 'barcode' | 'photo' | 'manual' | null) => void;

  // Optional label override for the barcode scan trigger
  scanIdLabel?: string;
}

// ── Component ─────────────────────────────────────────────────────────

export default function Step2Identity({
  recipientName, setRecipientName,
  idScanning, idScanError, idVerified, idDescription, idScanMethod,
  idFrontImage, idBackImage,
  manualFirstName, setManualFirstName,
  manualLastName, setManualLastName,
  manualMiddleName, setManualMiddleName,
  manualDob, setManualDob,
  manualDlNumber, setManualDlNumber,
  manualDlState, setManualDlState,
  manualGender, setManualGender,
  manualHeight, setManualHeight,
  manualWeight, setManualWeight,
  manualEyeColor, setManualEyeColor,
  manualHairColor, setManualHairColor,
  hasServiceAddress, addressCurrent, setAddressCurrent,
  currentAddress, setCurrentAddress,
  currentCity, setCurrentCity,
  currentState, setCurrentState,
  currentZip, setCurrentZip,
  onScanId, onCapturePhoto, onCompleteManual,
  activeCard, setActiveCard,
  scanIdLabel = 'Scan ID barcode',
}: Step2Props) {
  const idDone = idVerified || idFrontImage !== null;

  // Manual entry completeness check
  const manualComplete =
    manualFirstName.trim().length > 0 &&
    manualLastName.trim().length > 0 &&
    manualDob.length > 0 &&
    manualDlNumber.trim().length > 0 &&
    manualDlState.trim().length > 0 &&
    manualGender.length > 0 &&
    manualHeight.trim().length > 0 &&
    manualWeight.trim().length > 0 &&
    manualEyeColor.length > 0 &&
    manualHairColor.length > 0;

  return (
    <div className="p-4 pb-6 max-w-lg mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Your Identity</h2>
        <p className="text-[14px] text-gray-400 leading-relaxed">
          Tell us who you are. This information is recorded with your signature.
        </p>
      </div>

      {/* ── Name field ──────────────────────────────────────── */}
      <div>
        <FieldLabel required>Your full legal name</FieldLabel>
        <input
          className={inputCls}
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          autoComplete="name"
          placeholder="First and last name"
        />
      </div>

      {/* ── ID capture — three cards ────────────────────────── */}
      <div>
        <FieldLabel required>Verify your identity — choose one method</FieldLabel>
        <p className="text-[12px] text-gray-400 mb-3 leading-snug">
          Scanning your ID barcode adds greater evidentiary weight to this document.
          You are not required to produce ID — a photo or manual entry is also accepted.
        </p>

        <div className="space-y-3">
          {/* Card A — Barcode scan */}
          {idScanMethod === 'barcode' && idVerified ? (
            // Completed state
            <div className="p-3 rounded-sm border-2 border-green-700 bg-green-900 flex items-center gap-3">
              <Check size={18} className="text-green-400 shrink-0" />
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-green-400">Barcode scanned successfully</p>
                {idDescription && (
                  <p className="text-[12px] text-green-500 mt-0.5">{idDescription}</p>
                )}
              </div>
            </div>
          ) : (
            <div className={`rounded-sm border-2 overflow-hidden ${activeCard === 'barcode' ? 'border-blue-500' : 'border-gray-600'}`}>
              <button
                type="button"
                onClick={() => setActiveCard(activeCard === 'barcode' ? null : 'barcode')}
                className="w-full flex items-center gap-3 p-3.5 text-left bg-white active:bg-gray-50"
              >
                <ScanLine size={20} className="text-blue-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-white">Scan ID barcode</p>
                  <p className="text-[12px] text-gray-400 mt-0.5 leading-snug">
                    Take a photo of the barcode on the back of your licence or state ID.
                    Your name and description will fill in automatically.
                  </p>
                </div>
              </button>
              {activeCard === 'barcode' && (
                <div className="px-3.5 pb-3.5 space-y-2 bg-white border-t border-gray-700">
                  <label className="block mt-2 p-3 rounded-sm border border-dashed border-blue-500 bg-blue-900 text-center cursor-pointer active:opacity-80">
                    <p className="text-[14px] font-medium text-blue-300">
                      {idScanning ? 'Reading barcode…' : 'Open camera and scan barcode'}
                    </p>
                    <p className="text-[12px] text-blue-400 mt-0.5">
                      Tap to open camera
                    </p>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void onScanId(f);
                      }}
                    />
                  </label>
                  {idScanError && (
                    <p className="text-[13px] text-amber-400 bg-amber-900 border border-amber-700 rounded-sm px-3 py-2 leading-snug">
                      {idScanError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Card B — Photo */}
          {idScanMethod === 'photo' && idFrontImage ? (
            // Completed state
            <div className="p-3 rounded-sm border-2 border-green-700 bg-green-900 flex items-center gap-3">
              <Check size={18} className="text-green-400 shrink-0" />
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-green-400">
                  ID photo captured{idBackImage ? ' (front + back)' : ' (front)'}
                </p>
                <p className="text-[12px] text-green-500 mt-0.5">
                  Please fill in the required fields (gender, height, weight, hair, eye color)
                  if they are not already completed.
                </p>
              </div>
            </div>
          ) : (
            <div className={`rounded-sm border-2 overflow-hidden ${activeCard === 'photo' ? 'border-blue-500' : 'border-gray-600'}`}>
              <button
                type="button"
                onClick={() => setActiveCard(activeCard === 'photo' ? null : 'photo')}
                className="w-full flex items-center gap-3 p-3.5 text-left bg-white active:bg-gray-50"
              >
                <Camera size={20} className="text-blue-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-white">Take a photo of your ID</p>
                  <p className="text-[12px] text-gray-400 mt-0.5 leading-snug">
                    Front is required. Back is optional but encouraged.
                  </p>
                </div>
              </button>
              {activeCard === 'photo' && (
                <div className="px-3.5 pb-3.5 bg-white border-t border-gray-700">
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <label className="block p-3 rounded-sm border border-gray-600 bg-gray-50 text-center cursor-pointer active:opacity-80">
                      <Camera size={16} className="mx-auto text-gray-400 mb-1" />
                      <span className="text-[13px] text-gray-300">
                        {idFrontImage ? (
                          <><Check size={13} className="inline text-green-400 mr-0.5" />Front</>
                        ) : 'Front of ID *'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onCapturePhoto(f, 'front');
                        }}
                      />
                    </label>
                    <label className="block p-3 rounded-sm border border-gray-600 bg-gray-50 text-center cursor-pointer active:opacity-80">
                      <Camera size={16} className="mx-auto text-gray-400 mb-1" />
                      <span className="text-[13px] text-gray-300">
                        {idBackImage ? (
                          <><Check size={13} className="inline text-green-400 mr-0.5" />Back</>
                        ) : 'Back of ID (optional)'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onCapturePhoto(f, 'back');
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Card C — Manual entry */}
          {idScanMethod === 'manual' && idVerified ? (
            // Completed state
            <div className="p-3 rounded-sm border-2 border-green-700 bg-green-900 flex items-center gap-3">
              <Check size={18} className="text-green-400 shrink-0" />
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-green-400">ID entered manually</p>
                {idDescription && (
                  <p className="text-[12px] text-green-500 mt-0.5">{idDescription}</p>
                )}
              </div>
            </div>
          ) : (
            <div className={`rounded-sm border-2 overflow-hidden ${activeCard === 'manual' ? 'border-blue-500' : 'border-gray-600'}`}>
              <button
                type="button"
                onClick={() => setActiveCard(activeCard === 'manual' ? null : 'manual')}
                className="w-full flex items-center gap-3 p-3.5 text-left bg-white active:bg-gray-50"
              >
                <Pencil size={20} className="text-blue-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-white">Enter ID details manually</p>
                  <p className="text-[12px] text-gray-400 mt-0.5 leading-snug">
                    Type in the information from your driver's licence or state ID.
                  </p>
                </div>
              </button>
              {activeCard === 'manual' && (
                <div className="px-3.5 pb-3.5 bg-white border-t border-gray-700 space-y-3 mt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <FieldLabel required>First name</FieldLabel>
                      <input className={inputCls} value={manualFirstName} onChange={(e) => setManualFirstName(e.target.value)} placeholder="First" autoComplete="given-name" />
                    </div>
                    <div>
                      <FieldLabel required>Last name</FieldLabel>
                      <input className={inputCls} value={manualLastName} onChange={(e) => setManualLastName(e.target.value)} placeholder="Last" autoComplete="family-name" />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Middle name</FieldLabel>
                    <input className={inputCls} value={manualMiddleName} onChange={(e) => setManualMiddleName(e.target.value)} placeholder="Middle (optional)" autoComplete="additional-name" />
                  </div>
                  <div>
                    <FieldLabel required>Date of birth</FieldLabel>
                    <input type="date" className={inputCls} value={manualDob} onChange={(e) => setManualDob(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <FieldLabel required>DL / ID number</FieldLabel>
                      <input className={inputCls} value={manualDlNumber} onChange={(e) => setManualDlNumber(e.target.value)} placeholder="Licence #" />
                    </div>
                    <div>
                      <FieldLabel required>Issuing state</FieldLabel>
                      <input className={inputCls} value={manualDlState} onChange={(e) => setManualDlState(e.target.value.toUpperCase())} placeholder="UT" maxLength={2} />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Physical description</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <FieldLabel required>Gender</FieldLabel>
                      <select className={selectCls} value={manualGender} onChange={(e) => setManualGender(e.target.value)}>
                        <option value="">Select…</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Non-binary">Non-binary</option>
                      </select>
                    </div>
                    <div>
                      <FieldLabel required>Eye color</FieldLabel>
                      <select className={selectCls} value={manualEyeColor} onChange={(e) => setManualEyeColor(e.target.value)}>
                        <option value="">Select…</option>
                        {['Brown', 'Blue', 'Green', 'Hazel', 'Gray', 'Black'].map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <FieldLabel required>Hair color</FieldLabel>
                      <select className={selectCls} value={manualHairColor} onChange={(e) => setManualHairColor(e.target.value)}>
                        <option value="">Select…</option>
                        {['Black', 'Brown', 'Blonde', 'Red', 'Gray', 'White', 'Bald'].map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <FieldLabel required>Height</FieldLabel>
                      <input className={inputCls} value={manualHeight} onChange={(e) => setManualHeight(e.target.value)} placeholder={`5'10"`} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel required>Weight (lbs)</FieldLabel>
                    <input className={inputCls} type="number" inputMode="numeric" value={manualWeight} onChange={(e) => setManualWeight(e.target.value)} placeholder="180" />
                  </div>

                  <button
                    type="button"
                    onClick={onCompleteManual}
                    disabled={!manualComplete}
                    className="w-full py-3 rounded-sm font-semibold text-[14px] bg-blue-600 text-white disabled:opacity-40 active:opacity-80"
                  >
                    Confirm ID information
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Address confirmation (shown after any ID method started) ── */}
      {idDone && hasServiceAddress && (
        <div className="space-y-3">
          <p className="text-[14px] font-medium text-gray-200">
            Is the address on your ID your current address?
          </p>
          <div className="flex gap-3">
            {([['Yes', true], ['No', false]] as const).map(([txt, val]) => (
              <button
                key={txt}
                type="button"
                onClick={() => setAddressCurrent(val)}
                className={`flex-1 py-3 rounded-sm border-2 text-[14px] font-semibold transition-colors ${
                  addressCurrent === val
                    ? 'border-blue-500 bg-blue-900 text-blue-300'
                    : 'border-gray-600 bg-transparent text-gray-300'
                }`}
              >
                {txt}
              </button>
            ))}
          </div>
          {!addressCurrent && (
            <div className="space-y-2">
              <div>
                <FieldLabel>Current street address</FieldLabel>
                <input className={inputCls} value={currentAddress} onChange={(e) => setCurrentAddress(e.target.value)} placeholder="123 Main St" autoComplete="street-address" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <FieldLabel>City</FieldLabel>
                  <input className={inputCls} value={currentCity} onChange={(e) => setCurrentCity(e.target.value)} placeholder="City" autoComplete="address-level2" />
                </div>
                <div>
                  <FieldLabel>State</FieldLabel>
                  <input className={inputCls} value={currentState} onChange={(e) => setCurrentState(e.target.value.toUpperCase())} placeholder="UT" maxLength={2} autoComplete="address-level1" />
                </div>
                <div>
                  <FieldLabel>ZIP</FieldLabel>
                  <input className={inputCls} value={currentZip} onChange={(e) => setCurrentZip(e.target.value)} placeholder="84101" inputMode="numeric" maxLength={10} autoComplete="postal-code" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
