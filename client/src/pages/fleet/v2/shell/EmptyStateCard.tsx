import { ExternalLink } from 'lucide-react';

export interface EmptyStateCardProps {
  title: string;
  plannedPr: string;
  description: string;
  fleetioUrl?: string;
}

/** Styled empty-state for sidebar sections and vehicle-detail tabs that aren't
 *  built yet. Per spec §1: includes a "View in Fleet.io" deep-link so the
 *  operator can grab the data from Fleet.io until the matching PR ships. */
export function EmptyStateCard({ title, plannedPr, description, fleetioUrl }: EmptyStateCardProps) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised p-6 max-w-xl">
      <h2 className="text-base font-semibold text-rmpg-100 mb-1">{title}</h2>
      <p className="text-sm text-rmpg-400 mb-2">Coming in {plannedPr}.</p>
      <p className="text-sm text-rmpg-200 mb-4">{description}</p>
      {fleetioUrl ? (
        <a
          href={fleetioUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-brand-400 hover:underline"
        >
          View in Fleet.io <ExternalLink className="w-3 h-3" />
        </a>
      ) : null}
    </div>
  );
}
