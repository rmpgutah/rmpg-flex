// ============================================================
// RMPG Flex — Fleet-v2 "create in legacy" affordance
// ------------------------------------------------------------
// Several fleet-v2 list routes (FuelEntriesRoute, ServiceRoute,
// InspectionsRoute, VendorsRoute, PersonnelRoute, DashCamerasRoute,
// AnalysisFormsRoute) shipped READ-ONLY in PR 7'a — no "+ New X"
// affordance at all. Operators had no path to create from v2 unless
// they happened to know /fleet (legacy) hosts the working flows.
//
// This component is the uniform stand-in until each route gets a
// fully-native v2 modal (PR 7'c batch). It renders a small pill-style
// link to the legacy fleet page, labeled clearly with what kind of
// entity will be created + the muted "(/fleet legacy)" tag so the
// operator knows the click jumps surfaces.
//
// Pattern matches the existing EmptyStateCard's "Open in Fleet.io"
// link — same affordance shape, different destination.
// ============================================================
import { Plus, ExternalLink } from 'lucide-react';

export interface LegacyActionLinkProps {
  /** Human label, e.g. "New Fuel Entry". The "+ " prefix is added automatically. */
  label: string;
  /** Hash anchor on /fleet that pre-opens the right modal, OR just '/fleet'. */
  legacyPath: string;
  /** Optional aria-label override. Defaults to "Create new <label> in legacy fleet view". */
  ariaLabel?: string;
}

export function LegacyActionLink({ label, legacyPath, ariaLabel }: LegacyActionLinkProps) {
  return (
    <a
      href={legacyPath}
      target="_blank"
      rel="noopener"
      aria-label={ariaLabel ?? `Create new ${label} in legacy fleet view`}
      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110"
    >
      <Plus className="w-3 h-3" />
      <span>{label}</span>
      <span className="hidden sm:inline text-[9px] opacity-70 ml-1">
        <ExternalLink className="w-2.5 h-2.5 inline align-baseline" /> /fleet legacy
      </span>
    </a>
  );
}
