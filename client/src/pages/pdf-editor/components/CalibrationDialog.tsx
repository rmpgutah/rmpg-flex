import { useState } from 'react';
import { Ruler, X } from 'lucide-react';
import { MeasureCalibration, DEFAULT_RENDER_SCALE } from '../types';

// Real-world measurement calibration. The operator states that a reference
// length they can see on the page (in inches at 100% / PDF points) equals a
// known real-world distance — e.g. a 1.00 in scale bar = 10 ft. From that we
// derive realPerPdfPoint = realLength / (refInches * 72), which the measure
// + area tools use to convert on-page PDF points into real units.
//
// Pure config dialog — no PDF I/O, no network. Persisted by the editor into
// EditorPreferences.calibration.

interface Props {
  open: boolean;
  value: MeasureCalibration | null;
  onClose: () => void;
  onApply: (cal: MeasureCalibration | null) => void;
}

const inputCls = 'w-full bg-surface-sunken border border-border-default text-xs text-rmpg-100 px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]';
const labelCls = 'text-[9px] uppercase tracking-wider text-rmpg-500 block mb-0.5';

export default function CalibrationDialog({ open, value, onClose, onApply }: Props) {
  const [refLength, setRefLength] = useState('1');
  const [refUnit, setRefUnit] = useState<'in' | 'pt' | 'cm'>('in');
  const [realLength, setRealLength] = useState('10');
  const [realUnit, setRealUnit] = useState('ft');

  if (!open) return null;

  // Convert the reference length to PDF points (1 in = 72 pt, 1 cm = 28.346 pt).
  const refToPoints = (n: number): number =>
    refUnit === 'in' ? n * 72 : refUnit === 'cm' ? n * 28.3464567 : n;

  const apply = () => {
    const ref = parseFloat(refLength);
    const real = parseFloat(realLength);
    const refPts = refToPoints(ref);
    if (!Number.isFinite(ref) || !Number.isFinite(real) || refPts <= 0 || real <= 0) return;
    const realPerPdfPoint = real / refPts;
    onApply({
      realPerPdfPoint,
      unit: realUnit.trim() || 'units',
      note: `${ref} ${refUnit} on page = ${real} ${realUnit.trim() || 'units'}`,
    });
    onClose();
  };

  // Preview: how many real units a single screen pixel (at render scale) covers,
  // so the operator sanity-checks the calibration before applying.
  const ref = parseFloat(refLength), real = parseFloat(realLength);
  const refPts = refToPoints(ref);
  const perPoint = refPts > 0 && Number.isFinite(real) ? real / refPts : 0;
  const perInch = perPoint * 72;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-base border border-border-default rounded-[2px] p-4 max-w-[420px] w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-rmpg-100 inline-flex items-center gap-2">
            <Ruler className="w-4 h-4 text-[#d4a017]" /> Measurement calibration
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-rmpg-100" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <p className="text-[10px] text-rmpg-400 mb-3">
          Set a real-world scale so the measure and area tools report calibrated
          values. State a reference length on the page and what it equals in the
          real world (e.g. a 1&nbsp;in scale bar = 10&nbsp;ft).
        </p>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>On the page, a length of…</label>
            <div className="flex gap-1">
              <input id="ff-calibration-ref" type="number" min={0} step="any" value={refLength}
                onChange={e => setRefLength(e.target.value)} className={inputCls} />
              <select id="ff-calibration-refunit" value={refUnit} onChange={e => setRefUnit(e.target.value as 'in' | 'pt' | 'cm')} className={`${inputCls} w-20`}>
                <option value="in">inches</option>
                <option value="pt">points</option>
                <option value="cm">cm</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>…equals, in the real world</label>
            <div className="flex gap-1">
              <input id="ff-calibration-real" type="number" min={0} step="any" value={realLength}
                onChange={e => setRealLength(e.target.value)} className={inputCls} />
              <input id="ff-calibration-realunit" value={realUnit} onChange={e => setRealUnit(e.target.value)}
                placeholder="ft" className={`${inputCls} w-20`} />
            </div>
          </div>

          {perPoint > 0 && (
            <div className="text-[10px] text-rmpg-300 bg-surface-sunken border border-border-default rounded-sm px-2 py-1.5">
              Scale: <span className="text-[#d4a017]">1 in on page ≈ {perInch.toFixed(2)} {realUnit.trim() || 'units'}</span>
              <span className="text-rmpg-600"> · render scale {DEFAULT_RENDER_SCALE}×</span>
            </div>
          )}

          {value && (
            <div className="text-[10px] text-rmpg-500">
              Current: <span className="text-rmpg-300">{value.note ?? `${value.realPerPdfPoint.toFixed(4)} ${value.unit}/pt`}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button type="button" onClick={apply} className="btn-primary text-[11px] px-3 py-1">Apply calibration</button>
          {value && (
            <button type="button" onClick={() => { onApply(null); onClose(); }}
              className="btn-secondary text-[11px] px-3 py-1">Clear (back to raw in/pt)</button>
          )}
          <button type="button" onClick={onClose} className="ml-auto text-[11px] text-rmpg-400 hover:text-rmpg-100 px-2 py-1">Cancel</button>
        </div>
      </div>
    </div>
  );
}
