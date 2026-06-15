import { sectionAnchorId } from '../../../utils/sectionAnchor';
import type { RecordTabId } from './SpillmanRecordTabs';

export interface FormSection { label: string; target: string; }

const sec = (label: string, title: string): FormSection => ({ label, target: sectionAnchorId(title) });

export const RECORD_FORM_SECTIONS: Record<RecordTabId, FormSection[]> = {
  persons: [
    sec('Physical', 'Physical Description'),
    sec('Contact', 'Contact & Address'),
    sec('Identification', 'Identification'),
    sec('Associations', 'Legal & Associations'),
    sec('Caution', 'Officer Safety / Caution'),
  ],
  vehicles: [],
  properties: [],
  businesses: [],
  evidence: [],
};
