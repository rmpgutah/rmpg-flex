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
  // Titles must match the CollapsibleSection `title` props in each detail panel
  // (VehiclesTab/PropertiesTab/EvidenceTab) — sectionAnchorId slugifies both
  // sides identically. Sections with a dynamic count in the title (e.g.
  // "Incident History (3)", "Chain of Custody (2)") are intentionally omitted
  // because the count makes the anchor slug unstable.
  vehicles: [
    sec('Details', 'Vehicle Details'),
    sec('Mechanical', 'Mechanical'),
    sec('Registration', 'Registration & Insurance'),
    sec('Stolen / Tow', 'Stolen / Tow Status'),
    sec('Damage', 'Damage & Features'),
  ],
  properties: [
    sec('Details', 'Property Details'),
    sec('Security', 'Security & Access'),
    sec('Post Orders', 'Post Orders'),
    sec('Hazards', 'Hazard Notes'),
    sec('Access', 'Access Instructions'),
  ],
  businesses: [
    sec('Business', 'Business Information'),
    sec('Contact', 'Contact & Address'),
    sec('Owner', 'Owner & Key Contact'),
    sec('Notes', 'Notes'),
  ],
  evidence: [
    sec('Description', 'Description'),
    sec('Collection', 'Collection & Storage'),
    sec('Item', 'Item Details'),
    sec('Lab', 'Lab / Analysis'),
    sec('Disposal', 'Disposal'),
  ],
};
