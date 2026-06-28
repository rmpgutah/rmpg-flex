import React from 'react';
import { DASHBOARD_VIEWS, DASHBOARD_VIEW_LABELS, type DashboardView } from './dashboardViews';

interface Props {
  view: DashboardView;
  canSwitch: boolean;
  onChange: (view: DashboardView) => void;
}

/**
 * Toolbar "View:" segmented control. Renders nothing for roles that may not
 * switch (the page still shows their role-default view).
 */
export default function DashboardViewSelector({ view, canSwitch, onChange }: Props) {
  if (!canSwitch) return null;
  return (
    <div className="spm-view-seg" role="group" aria-label="Dashboard view">
      <span className="spm-view-seg-label">View:</span>
      {DASHBOARD_VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          className={`spm-view-seg-btn ${v === view ? 'on' : ''}`.trim()}
          aria-pressed={v === view}
          onClick={() => onChange(v)}
        >
          {DASHBOARD_VIEW_LABELS[v]}
        </button>
      ))}
    </div>
  );
}
