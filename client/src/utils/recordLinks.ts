// ============================================================
// Record-linking registry — single source of truth for the
// cross-entity linking UI (LinkRecordModal + LinkedRecordsSection).
// ============================================================
// Every linkable record type, its display label, lucide icon, and
// Spillman-theme badge colors live here ONCE so the "Link Record"
// picker, the "Linked Records" list badges, and any other surface
// stay in lockstep. Historically these lists drifted: the modal
// offered 4 target types while RecordEntityType declared 8 and the
// search backend silently returned nothing for the missing ones.
//
// The 8 types mirror `RecordEntityType` in types/index.ts and the
// backend ENTITY tables in src/routes/records.ts. Keep all three in
// sync when adding a type.

import {
  UserCircle,
  Car,
  Building2,
  Briefcase,
  Package,
  FileWarning,
  FolderOpen,
  Gavel,
  type LucideIcon,
} from 'lucide-react';
import type { RecordEntityType } from '../types';

export interface EntityMeta {
  /** Singular human label shown in the picker + type badge ("Person"). */
  label: string;
  /** Plural label for headers ("People", "Vehicles"). */
  plural: string;
  icon: LucideIcon;
  /** Spillman pure-black theme — zero blue. */
  color: { text: string; bg: string; border: string };
}

// Order here is the order the link picker renders its type buttons.
export const ENTITY_META: Record<RecordEntityType, EntityMeta> = {
  person: {
    label: 'Person', plural: 'People', icon: UserCircle,
    color: { text: 'text-gray-300', bg: 'bg-gray-900/30', border: 'border-gray-700/50' },
  },
  vehicle: {
    label: 'Vehicle', plural: 'Vehicles', icon: Car,
    color: { text: 'text-gray-300', bg: 'bg-[#1f1f1f]', border: 'border-[#2e2e2e]' },
  },
  property: {
    label: 'Property', plural: 'Property', icon: Building2,
    color: { text: 'text-green-400', bg: 'bg-green-900/30', border: 'border-green-700/50' },
  },
  business: {
    label: 'Business', plural: 'Businesses', icon: Briefcase,
    color: { text: 'text-amber-400', bg: 'bg-amber-900/30', border: 'border-amber-700/50' },
  },
  evidence: {
    label: 'Evidence', plural: 'Evidence', icon: Package,
    color: { text: 'text-purple-400', bg: 'bg-purple-900/30', border: 'border-purple-700/50' },
  },
  incident: {
    label: 'Incident', plural: 'Incidents', icon: FileWarning,
    color: { text: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-700/50' },
  },
  case: {
    label: 'Case', plural: 'Cases', icon: FolderOpen,
    color: { text: 'text-brand-400', bg: 'bg-brand-900/30', border: 'border-brand-700/50' },
  },
  warrant: {
    label: 'Warrant', plural: 'Warrants', icon: Gavel,
    color: { text: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700/50' },
  },
};

const DEFAULT_META: EntityMeta = {
  label: 'Record', plural: 'Records', icon: Package,
  color: { text: 'text-rmpg-400', bg: 'bg-rmpg-800/30', border: 'border-rmpg-600/50' },
};

/** Every type a record can be linked to, in picker display order. */
export const LINKABLE_TYPES = Object.keys(ENTITY_META) as RecordEntityType[];

export function getEntityMeta(type: string): EntityMeta {
  return ENTITY_META[type as RecordEntityType] ?? DEFAULT_META;
}

export function getRecordTypeIcon(type: string): LucideIcon {
  return getEntityMeta(type).icon;
}

export function getRecordTypeColor(type: string) {
  return getEntityMeta(type).color;
}

/** Title-case singular label for a type ("incident" → "Incident"). */
export function getEntityLabel(type: string): string {
  return getEntityMeta(type).label;
}

// ── Relationship vocabulary ──────────────────────────────────
// Stored as a normalized code ('evidence_linked'); displayed in
// plain language ('Evidence Linked'). The picker shows the labels;
// the list badge humanizes whatever code is on the row (covering
// legacy/free-form values too).
export const RELATIONSHIP_OPTIONS = [
  'Associated',
  'Owner',
  'Resident',
  'Employee',
  'Witness',
  'Suspect',
  'Victim',
  'Involved Party',
  'Registered Keeper',
  'Evidence Linked',
  'Related',
  'Other',
] as const;

export const DEFAULT_RELATIONSHIP_CODE = 'associated';

/** "Evidence Linked" → "evidence_linked" (the stored form). */
export function relationshipCode(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, '_');
}

/** "evidence_linked" / "evidence linked" → "Evidence Linked" (display). */
export function humanizeRelationship(code: string | null | undefined): string {
  if (!code) return 'Associated';
  return String(code)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || 'Associated';
}
