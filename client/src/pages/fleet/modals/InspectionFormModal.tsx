import { useId, useEffect } from 'react';
import { ClipboardCheck } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
import type { InspectionType, InspectionResult, InspectionItemStatus, InspectionItem } from '../../../types';

import RichTextArea from '../../../components/RichTextArea';
export interface InspectionFormState {
  inspection_type: InspectionType;
  inspector_name: string;
  inspection_date: string;
  mileage: string;
  overall_result: InspectionResult;
  items: InspectionItem[];
  notes: string;
}

export const DEFAULT_INSPECTION_ITEMS: InspectionItem[] = [
  // Exterior
  { category: 'Exterior', item: 'Body/Paint Condition', status: 'pass', notes: '' },
  { category: 'Exterior', item: 'Lights (Head/Tail/Brake/Turn)', status: 'pass', notes: '' },
  { category: 'Exterior', item: 'Tires & Tread Depth', status: 'pass', notes: '' },
  { category: 'Exterior', item: 'Windshield & Glass', status: 'pass', notes: '' },
  { category: 'Exterior', item: 'Mirrors', status: 'pass', notes: '' },
  { category: 'Exterior', item: 'Emergency Lights/Lightbar', status: 'pass', notes: '' },
  // Interior
  { category: 'Interior', item: 'Seatbelts', status: 'pass', notes: '' },
  { category: 'Interior', item: 'Horn', status: 'pass', notes: '' },
  { category: 'Interior', item: 'Radio/MDT', status: 'pass', notes: '' },
  { category: 'Interior', item: 'A/C & Heater', status: 'pass', notes: '' },
  { category: 'Interior', item: 'Gauges & Warning Lights', status: 'pass', notes: '' },
  { category: 'Interior', item: 'Cleanliness', status: 'pass', notes: '' },
  // Mechanical
  { category: 'Mechanical', item: 'Brakes', status: 'pass', notes: '' },
  { category: 'Mechanical', item: 'Steering', status: 'pass', notes: '' },
  { category: 'Mechanical', item: 'Fluid Levels', status: 'pass', notes: '' },
  { category: 'Mechanical', item: 'Exhaust System', status: 'pass', notes: '' },
  // Safety Equipment
  { category: 'Safety Equipment', item: 'Fire Extinguisher', status: 'pass', notes: '' },
  { category: 'Safety Equipment', item: 'First Aid Kit', status: 'pass', notes: '' },
  { category: 'Safety Equipment', item: 'Reflective Triangles', status: 'pass', notes: '' },
  { category: 'Safety Equipment', item: 'PPE', status: 'pass', notes: '' },
];

export const EMPTY_INSPECTION_FORM: InspectionFormState = {
  inspection_type: 'pre_trip',
  inspector_name: '',
  inspection_date: '',
  mileage: '',
  overall_result: 'pass',
  items: DEFAULT_INSPECTION_ITEMS.map(i => ({ ...i })),
  notes: '',
};

const INSPECTION_TYPES: { value: InspectionType; label: string }[] = [
  { value: 'pre_trip', label: 'Pre-Trip' },
  { value: 'post_trip', label: 'Post-Trip' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
];

const ITEM_STATUSES: { value: InspectionItemStatus; label: string }[] = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'needs_attention', label: 'Attention' },
  { value: 'na', label: 'N/A' },
];

const STATUS_COLORS: Record<InspectionItemStatus, string> = {
  pass: 'text-green-400',
  fail: 'text-red-400',
  needs_attention: 'text-amber-400',
  na: 'text-rmpg-500',
};

function computeOverallResult(items: InspectionItem[]): InspectionResult {
  const hasAnyFail = items.some(i => i.status === 'fail');
  const hasAnyAttention = items.some(i => i.status === 'needs_attention');
  if (hasAnyFail) return 'fail';
  if (hasAnyAttention) return 'needs_attention';
  return 'pass';
}

interface Props {
  isOpen: boolean;
  mode?: 'create' | 'edit';
  form: InspectionFormState;
  onChange: (form: InspectionFormState) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}

export default function InspectionFormModal({ isOpen, mode = 'create', form, onChange, onSave, onClose, saving }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const setField = (field: keyof InspectionFormState, value: any) =>
    onChange({ ...form, [field]: value });

  const updateItem = (index: number, field: keyof InspectionItem, value: string) => {
    const newItems = form.items.map((item, i) => i === index ? { ...item, [field]: value } : item);
    const newResult = computeOverallResult(newItems);
    onChange({ ...form, items: newItems, overall_result: newResult });
  };

  // Group items by category
  const categories = Array.from(new Set(form.items.map(i => i.category)));

  const resultLabel: Record<InspectionResult, string> = {
    pass: 'PASS', fail: 'FAIL', needs_attention: 'NEEDS ATTENTION',
  };
  const resultColor: Record<InspectionResult, string> = {
    pass: 'text-green-400 bg-green-900/30 border-green-700/40',
    fail: 'text-red-400 bg-red-900/30 border-red-700/40',
    needs_attention: 'text-amber-400 bg-amber-900/30 border-amber-700/40',
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ background: 'rgba(0,0,0,0.6)' }} onClick={saving ? undefined : onClose}>
      <div className="panel-beveled w-[680px] max-w-full mx-4 max-h-[85vh] flex flex-col bg-surface-raised" onClick={(e) => e.stopPropagation()}>
        <PanelTitleBar title={mode === 'edit' ? 'EDIT INSPECTION' : 'VEHICLE INSPECTION'} icon={ClipboardCheck} id={titleId}>
          <span className={`px-2 py-0.5 text-[9px] font-bold uppercase border ${resultColor[form.overall_result]}`}>
            {resultLabel[form.overall_result]}
          </span>
          <button type="button" className="toolbar-btn text-[9px] ml-2" onClick={onClose}>X</button>
        </PanelTitleBar>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Top form fields */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Type *</label>
              <select className="select-dark w-full text-[11px] min-h-[36px]" value={form.inspection_type}
                onChange={(e) => setField('inspection_type', e.target.value)}>
                {INSPECTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Inspector *</label>
              <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.inspector_name}
                onChange={(e) => setField('inspector_name', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Date / Time *</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="datetime-local" step="1" value={form.inspection_date}
                onChange={(e) => setField('inspection_date', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Mileage</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" value={form.mileage}
                onChange={(e) => setField('mileage', e.target.value)} />
            </div>
          </div>

          {/* Checklist grouped by category */}
          {categories.map(category => (
            <div key={category} className="panel-beveled bg-surface-base">
              <div className="px-3 py-1.5 border-b border-rmpg-700 bg-surface-sunken">
                <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">{category}</h4>
              </div>
              <div className="divide-y divide-rmpg-700">
                {form.items.map((item, index) => {
                  if (item.category !== category) return null;
                  return (
                    <div key={index} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="text-[10px] text-rmpg-300 flex-1 min-w-0">{item.item}</span>
                      <select
                        className={`select-dark text-[10px] py-0.5 px-1.5 w-24 ${STATUS_COLORS[item.status]}`}
                        value={item.status}
                        onChange={(e) => updateItem(index, 'status', e.target.value)}
                      >
                        {ITEM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <input
                        className="input-dark text-[9px] py-0.5 px-1.5 w-40 min-h-[36px]"
                        placeholder="Notes..."
                        value={item.notes || ''}
                        onChange={(e) => updateItem(index, 'notes', e.target.value)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Overall notes */}
          <div>
            <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Additional Notes</label>
            <RichTextArea className="input-dark w-full text-[10px] h-16 resize-none min-h-[36px]" value={form.notes}
              onChange={(e) => setField('notes', e.target.value)} maxLength={3000} />
            <div className="text-[8px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/3000</div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={onSave} disabled={saving || !form.inspector_name.trim() || !form.inspection_date}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Update Inspection' : 'Submit Inspection'}
          </button>
        </div>
      </div>
    </div>
  );
}
