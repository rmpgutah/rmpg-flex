// client/src/pages/warrants/WarrantsListTab.tsx
// ============================================================
// Warrants — List tab
// ============================================================
// Extracted from the WarrantsPage.tsx megafile (see
// docs/superpowers/specs/2026-07-14-warrants-page-rebuild-design.md and
// docs/superpowers/plans/2026-07-14-warrants-list-tab-extraction.md).
//
// Owns: the warrant list/filters/search/sort/pagination/batch-actions,
// the selected-warrant detail panel, and the Serve/Delete/Archive/
// Unarchive/Update-status actions (all of which mutate this tab's own
// `warrants` array, hence why they live here and not in the shell).
//
// The New/Edit Warrant form modal is still owned by the shell
// (WarrantsPage.tsx) — deliberately deferred to a later extraction phase.
// Because that modal's save handler needs to update THIS tab's warrant
// list and error banner, this component exposes a WarrantsListTabHandle
// via forwardRef/useImperativeHandle that the shell calls into after a
// successful save.
// ============================================================

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle, Eye, Loader2, MapPin, User, X,
} from 'lucide-react';
import IconButton from '../../components/IconButton';
import ConfirmDialog from '../../components/ConfirmDialog';
import ViewOnMapLink from '../../components/ViewOnMapLink';
import JurisdictionLookup from '../../components/JurisdictionLookup';
import PrintRecordButton from '../../components/PrintRecordButton';
import WarrantNsopwStatus from '../../components/WarrantNsopwStatus';
import LinkedEmailsSection from '../../components/LinkedEmailsSection';
import EmailedDocuments from '../../components/EmailedDocuments';
import CollapsibleSection from '../../components/CollapsibleSection';
import StatusPill from '../../components/warrants/StatusPill';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import {
  priorityBucket, priorityChipClass, formatAge, freshnessClass, freshnessIcon,
  stateFromSource,
} from '../../utils/warrantListHelpers';
import { buildWarrantPacketPdf } from '../../utils/warrantPacket';
import { displayUserName } from '../../utils/userDisplay';
import type { Warrant, UnifiedWarrant } from '../WarrantsPage';

export interface WarrantsListTabHandle {
  /** Re-fetch the current page of the list (used after the shell's Form modal saves). */
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  /** Patch a single warrant in the already-loaded list without a full refetch. */
  applyWarrantUpdate: (updated: Warrant) => void;
  /** If `id` matches the currently-selected/expanded warrant, re-fetch its detail. */
  refetchIfSelected: (id: number) => void;
  /** Surface an error in this tab's error banner (used by the shell's Form modal). */
  setListError: (message: string | null) => void;
}

export interface WarrantsListTabProps {
  /** Controls visibility without unmounting — see the shell-wiring task (Task 5). */
  isVisible: boolean;
  user: { role?: string; full_name?: string; badge_number?: string } | null;
  isAdminOrManager: boolean;
  isGodMode: boolean;
  canManageWarrants: boolean;
  isMobile: boolean;
  navigate: NavigateFunction;
  /** From the shell's useSearchParams() — read once on mount for deep-link init. */
  initialPersonId: string | null;
  initialWarrantId: string | null;
  /** Whether the shell's Form modal is currently open (used to hide the mobile FAB). */
  formOpen: boolean;
  onOpenNewForm: () => void;
  onOpenEditForm: (w: Warrant) => void;
  onOpenPersonProfile: (personId: number) => void;
}

const WarrantsListTab = forwardRef<WarrantsListTabHandle, WarrantsListTabProps>(function WarrantsListTab(props, ref) {
  const { isVisible } = props;
  const { addToast } = useToast();

  useImperativeHandle(ref, () => ({
    refresh: async (opts) => { /* filled in by the next task in this plan */ },
    applyWarrantUpdate: (updated) => { /* filled in by the next task in this plan */ },
    refetchIfSelected: (id) => { /* filled in by the next task in this plan */ },
    setListError: (message) => { /* filled in by the next task in this plan */ },
  }));

  return (
    <div style={{ display: isVisible ? undefined : 'none' }}>
      {/* filled in by the next task in this plan */}
    </div>
  );
});

export default WarrantsListTab;
