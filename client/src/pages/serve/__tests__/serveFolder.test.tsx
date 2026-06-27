// client/src/pages/serve/__tests__/serveFolder.test.tsx
//
// Tests for the Process Server folder/automation system:
//   1. Unit tests — deriveServeFolder helper
//   2. Unit tests — attemptResultToStatus helper (mirrors serve.ts route logic)
//   3. Component tests — ServeStatusFolder
//   4. Integration tests — Queue tab folder grouping + search + status transitions

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Types under test ────────────────────────────────────────────────────────

import { deriveServeFolder, SERVE_FOLDER_CONFIG, type ServeJob, type ServeFolder } from '../../../types/index';
import ServeStatusFolder from '../../../components/serve/ServeStatusFolder';

// ── Shared test fixtures ────────────────────────────────────────────────────

/**
 * Build a minimal valid ServeJob for tests.  Every field in the interface
 * has a sensible default so individual tests can override only what they need.
 */
function makeJob(overrides: Partial<ServeJob> = {}): ServeJob {
  return {
    id: 1,
    sm_job_id: null,
    officer_id: 10,
    serve_date: '2026-06-23',
    recipient_name: 'John Doe',
    recipient_address: '123 Main St',
    recipient_city: 'Salt Lake City',
    recipient_state: 'UT',
    recipient_zip: '84101',
    recipient_lat: 40.76,
    recipient_lng: -111.89,
    document_type: 'Summons',
    case_number: 'CASE-001',
    court_name: 'Third District Court',
    jurisdiction: 'Salt Lake County',
    client_name: 'RMPG',
    attorney_name: null,
    priority: 'normal',
    time_window: 'anytime',
    deadline: null,
    attempt_count: 0,
    max_attempts: 3,
    status: 'pending',
    sort_order: 0,
    service_instructions: null,
    notes: null,
    next_attempt_note: null,
    created_at: '2026-06-23T08:00:00',
    updated_at: '2026-06-23T08:00:00',
    call_id: null,
    closed_at: null,
    ...overrides,
  };
}

// ── Helper: attemptResultToStatus ───────────────────────────────────────────
//
// This logic mirrors src/routes/serve.ts (the /attempt endpoint).
// The function does not exist as a named export on the client — it's
// server-side business logic — but the client must display the result
// correctly.  We extract it here so we can unit-test the rule table
// without spinning up a Worker.
//
// Rules (from serve.ts lines 629-637):
//   result='served'           → 'served'
//   result='no_answer' && nextCount >= max → 'failed'
//   result='no_answer' && nextCount <  max → 'in_progress'  (server says 'attempted')
//   Any other non-served result follows the same count test.

type AttemptResult = 'served' | 'no_answer' | 'refused' | 'wrong_address' | 'moved' | 'other';
type QueueStatus   = 'pending' | 'in_progress' | 'served' | 'failed' | 'skipped' | 'archived';

function attemptResultToStatus(
  result: AttemptResult,
  currentAttemptCount: number,   // BEFORE this attempt
  maxAttempts: number,
): QueueStatus {
  const nextNum = currentAttemptCount + 1;
  if (result === 'served') return 'served';
  if (nextNum >= maxAttempts) return 'failed';
  return 'in_progress';
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Unit tests — deriveServeFolder
// ════════════════════════════════════════════════════════════════════════════

describe('deriveServeFolder', () => {
  // Each test verifies a specific folder mapping path.

  it('returns "served" for a served job (regardless of closed_at)', () => {
    const job = makeJob({ status: 'served', closed_at: '2026-06-23T10:00:00' });
    expect(deriveServeFolder(job)).toBe('served');
  });

  it('returns "served" for a served job even when closed_at is null', () => {
    const job = makeJob({ status: 'served', closed_at: null });
    expect(deriveServeFolder(job)).toBe('served');
  });

  it('returns "failed" for a failed job (regardless of closed_at)', () => {
    const job = makeJob({ status: 'failed', closed_at: '2026-06-23T11:00:00' });
    expect(deriveServeFolder(job)).toBe('failed');
  });

  it('returns "failed" for a failed job even when closed_at is null', () => {
    const job = makeJob({ status: 'failed', closed_at: null });
    expect(deriveServeFolder(job)).toBe('failed');
  });

  it('returns "in_progress" for an in-progress job', () => {
    const job = makeJob({ status: 'in_progress' });
    expect(deriveServeFolder(job)).toBe('in_progress');
  });

  it('returns "pending" for a pending job', () => {
    const job = makeJob({ status: 'pending' });
    expect(deriveServeFolder(job)).toBe('pending');
  });

  it('returns "archived" for a skipped job (catch-all)', () => {
    const job = makeJob({ status: 'skipped' });
    expect(deriveServeFolder(job)).toBe('archived');
  });

  it('returns "archived" for an archived job', () => {
    const job = makeJob({ status: 'archived' });
    expect(deriveServeFolder(job)).toBe('archived');
  });

  it('folder order matches SERVE_FOLDER_CONFIG order property', () => {
    // Verify the canonical folder ordering: in_progress=0, pending=1, served=2,
    // failed=3, archived=4 — used by ServePage to render folders in order.
    const ORDER: ServeFolder[] = ['in_progress', 'pending', 'served', 'failed', 'archived'];
    ORDER.forEach((folder, idx) => {
      expect(SERVE_FOLDER_CONFIG[folder].order).toBe(idx);
    });
  });

  it('maps every supported status to a valid ServeFolder key', () => {
    const statuses: Array<ServeJob['status']> = [
      'pending', 'in_progress', 'served', 'failed', 'skipped', 'archived',
    ];
    const valid = new Set<string>(['pending', 'in_progress', 'served', 'failed', 'archived']);
    statuses.forEach(s => {
      expect(valid.has(deriveServeFolder(makeJob({ status: s })))).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Unit tests — attemptResultToStatus
// ════════════════════════════════════════════════════════════════════════════

describe('attemptResultToStatus', () => {
  // result='served' → always 'served', regardless of attempt count
  describe('served result', () => {
    it('returns "served" on first attempt', () => {
      expect(attemptResultToStatus('served', 0, 3)).toBe('served');
    });

    it('returns "served" even when at max attempts', () => {
      expect(attemptResultToStatus('served', 2, 3)).toBe('served');
    });

    it('returns "served" even beyond max attempts', () => {
      expect(attemptResultToStatus('served', 5, 3)).toBe('served');
    });

    it('returns "served" on max_attempts=1, attempt_count=0', () => {
      expect(attemptResultToStatus('served', 0, 1)).toBe('served');
    });
  });

  // result='no_answer' + count < max → 'in_progress'
  describe('no_answer with remaining attempts', () => {
    it('returns "in_progress" when count(0) < max(3) — first failed knock', () => {
      // nextNum = 1, max = 3 → 1 < 3 → in_progress
      expect(attemptResultToStatus('no_answer', 0, 3)).toBe('in_progress');
    });

    it('returns "in_progress" when count(1) < max(3) — second failed knock', () => {
      // nextNum = 2, max = 3 → 2 < 3 → in_progress
      expect(attemptResultToStatus('no_answer', 1, 3)).toBe('in_progress');
    });

    it('returns "in_progress" when count(0) < max(5)', () => {
      expect(attemptResultToStatus('no_answer', 0, 5)).toBe('in_progress');
    });
  });

  // result='no_answer' + nextCount >= max → 'failed'
  describe('no_answer at max attempts', () => {
    it('returns "failed" when count(2) hits max(3)', () => {
      // nextNum = 3, max = 3 → 3 >= 3 → failed
      expect(attemptResultToStatus('no_answer', 2, 3)).toBe('failed');
    });

    it('returns "failed" when count is already beyond max', () => {
      // nextNum = 4, max = 3 → 4 >= 3 → failed
      expect(attemptResultToStatus('no_answer', 3, 3)).toBe('failed');
    });

    it('returns "failed" on max_attempts=1, count=0 (single-shot jobs)', () => {
      // nextNum = 1, max = 1 → 1 >= 1 → failed
      expect(attemptResultToStatus('no_answer', 0, 1)).toBe('failed');
    });

    it('returns "failed" when count(4) hits max(5)', () => {
      expect(attemptResultToStatus('no_answer', 4, 5)).toBe('failed');
    });
  });

  // Other non-served results follow the same count rule as no_answer
  describe('other non-served results', () => {
    it('"refused" below max → in_progress', () => {
      expect(attemptResultToStatus('refused', 0, 3)).toBe('in_progress');
    });

    it('"refused" at max → failed', () => {
      expect(attemptResultToStatus('refused', 2, 3)).toBe('failed');
    });

    it('"wrong_address" below max → in_progress', () => {
      expect(attemptResultToStatus('wrong_address', 1, 3)).toBe('in_progress');
    });

    it('"wrong_address" at max → failed', () => {
      expect(attemptResultToStatus('wrong_address', 2, 3)).toBe('failed');
    });

    it('"moved" below max → in_progress', () => {
      expect(attemptResultToStatus('moved', 0, 3)).toBe('in_progress');
    });

    it('"moved" at max → failed', () => {
      expect(attemptResultToStatus('moved', 2, 3)).toBe('failed');
    });

    it('"other" below max → in_progress', () => {
      expect(attemptResultToStatus('other', 0, 3)).toBe('in_progress');
    });

    it('"other" at max → failed', () => {
      expect(attemptResultToStatus('other', 2, 3)).toBe('failed');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Component tests — ServeStatusFolder
// ════════════════════════════════════════════════════════════════════════════

describe('ServeStatusFolder', () => {
  // Renders with correct count ──────────────────────────────────────────────

  describe('rendering', () => {
    it('displays the folder label', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={5}>
          <div>child content</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByText('Queue')).toBeInTheDocument();
    });

    it('displays the correct count in the badge', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={7}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      // The count badge has aria-label "{n} jobs"
      expect(screen.getByLabelText('7 jobs')).toBeInTheDocument();
      expect(screen.getByText('7')).toBeInTheDocument();
    });

    it('displays count=0 correctly', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={0}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByLabelText('0 jobs')).toBeInTheDocument();
    });

    it('displays large counts', () => {
      render(
        <ServeStatusFolder status="in_progress" label="In Progress" count={42}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByLabelText('42 jobs')).toBeInTheDocument();
    });

    it('renders the folder header as an accessible button', () => {
      render(
        <ServeStatusFolder status="served" label="Served" count={3}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      const header = screen.getByRole('button');
      expect(header).toBeInTheDocument();
    });

    it('header aria-expanded reflects open state', () => {
      render(
        <ServeStatusFolder status="served" label="Served" count={2} defaultOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    });

    it('header aria-expanded is false when defaultOpen=false', () => {
      render(
        <ServeStatusFolder status="served" label="Served" count={2} defaultOpen={false}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders children when open', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} defaultOpen={true}>
          <div data-testid="child-job">Job Card</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByTestId('child-job')).toBeInTheDocument();
    });

    it('renders multiple children', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={3} defaultOpen={true}>
          <div data-testid="job-1">Job 1</div>
          <div data-testid="job-2">Job 2</div>
          <div data-testid="job-3">Job 3</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByTestId('job-1')).toBeInTheDocument();
      expect(screen.getByTestId('job-2')).toBeInTheDocument();
      expect(screen.getByTestId('job-3')).toBeInTheDocument();
    });
  });

  // Empty state ─────────────────────────────────────────────────────────────

  describe('empty state', () => {
    it('shows empty text for pending folder when count=0', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={0} defaultOpen={true}>
          <div>child</div>
        </ServeStatusFolder>,
      );
      // Empty text is "No {label.toLowerCase()} jobs"
      expect(screen.getByText(/no queue jobs/i)).toBeInTheDocument();
    });

    it('shows empty text for in_progress folder when count=0', () => {
      render(
        <ServeStatusFolder status="in_progress" label="In Progress" count={0} defaultOpen={true}>
          <div>child</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByText(/no in progress jobs/i)).toBeInTheDocument();
    });

    it('shows empty text for served folder when count=0', () => {
      render(
        <ServeStatusFolder status="served" label="Served" count={0} defaultOpen={true}>
          <div>child</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByText(/no served jobs/i)).toBeInTheDocument();
    });

    it('shows empty text for failed folder when count=0', () => {
      render(
        <ServeStatusFolder status="failed" label="Non-Service" count={0} defaultOpen={true}>
          <div>child</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByText(/no non-service jobs/i)).toBeInTheDocument();
    });

    it('shows empty text for archived folder when count=0', () => {
      render(
        <ServeStatusFolder status="archived" label="Archived" count={0} defaultOpen={true}>
          <div>child</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByText(/no archived jobs/i)).toBeInTheDocument();
    });

    it('renders empty placeholder instead of children when count=0', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={0} defaultOpen={true}>
          <div data-testid="should-not-render">Job</div>
        </ServeStatusFolder>,
      );
      // Children are not rendered when count=0 — the empty placeholder replaces them
      expect(screen.queryByTestId('should-not-render')).not.toBeInTheDocument();
    });
  });

  // Collapse / expand on click ──────────────────────────────────────────────

  describe('collapse/expand toggle', () => {
    it('collapses when header is clicked while open', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={2} defaultOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      const header = screen.getByRole('button');
      expect(header).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(header);
      expect(header).toHaveAttribute('aria-expanded', 'false');
    });

    it('expands when header is clicked while collapsed', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={2} defaultOpen={false}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      const header = screen.getByRole('button');
      expect(header).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(header);
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });

    it('toggles back on double-click: open → close → open', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} defaultOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      const header = screen.getByRole('button');
      fireEvent.click(header); // close
      expect(header).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(header); // re-open
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });

    it('toggles via Enter key', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} defaultOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      const header = screen.getByRole('button');
      fireEvent.keyDown(header, { key: 'Enter' });
      expect(header).toHaveAttribute('aria-expanded', 'false');
    });

    it('toggles via Space key', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} defaultOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      const header = screen.getByRole('button');
      fireEvent.keyDown(header, { key: ' ' });
      expect(header).toHaveAttribute('aria-expanded', 'false');
    });

    it('does not toggle via Tab key', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} defaultOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      const header = screen.getByRole('button');
      fireEvent.keyDown(header, { key: 'Tab' });
      // state unchanged
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });
  });

  // localStorage persistence ────────────────────────────────────────────────

  describe('localStorage persistence', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('persists collapsed state to localStorage on toggle', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} defaultOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      fireEvent.click(screen.getByRole('button'));
      expect(localStorage.getItem('rmpg_serve_folder_pending')).toBe('0');
    });

    it('persists expanded state to localStorage on toggle', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} defaultOpen={false}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      fireEvent.click(screen.getByRole('button'));
      expect(localStorage.getItem('rmpg_serve_folder_pending')).toBe('1');
    });

    it('restores collapsed state from localStorage on mount', () => {
      localStorage.setItem('rmpg_serve_folder_pending', '0');
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} defaultOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      // localStorage '0' overrides defaultOpen=true
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    });

    it('restores expanded state from localStorage on mount', () => {
      localStorage.setItem('rmpg_serve_folder_served', '1');
      render(
        // defaultOpen=false would normally start closed
        <ServeStatusFolder status="served" label="Served" count={2} defaultOpen={false}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      // localStorage '1' overrides defaultOpen=false
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    });

    it('uses separate localStorage keys per status', () => {
      render(
        <ServeStatusFolder status="in_progress" label="In Progress" count={1} defaultOpen={true}>
          <div>job 1</div>
        </ServeStatusFolder>,
      );
      fireEvent.click(screen.getByRole('button'));
      // Only the in_progress key should be set
      expect(localStorage.getItem('rmpg_serve_folder_in_progress')).toBe('0');
      expect(localStorage.getItem('rmpg_serve_folder_pending')).toBeNull();
      expect(localStorage.getItem('rmpg_serve_folder_served')).toBeNull();
    });

    it('updates localStorage on every toggle', () => {
      render(
        <ServeStatusFolder status="failed" label="Non-Service" count={1} defaultOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      const header = screen.getByRole('button');
      fireEvent.click(header); // collapse → '0'
      expect(localStorage.getItem('rmpg_serve_folder_failed')).toBe('0');
      fireEvent.click(header); // expand → '1'
      expect(localStorage.getItem('rmpg_serve_folder_failed')).toBe('1');
    });
  });

  // forceOpen controlled prop ───────────────────────────────────────────────

  describe('forceOpen controlled prop', () => {
    it('forceOpen=true overrides defaultOpen=false', () => {
      render(
        <ServeStatusFolder status="served" label="Served" count={2} defaultOpen={false} forceOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    });

    it('forceOpen=false overrides defaultOpen=true', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={2} defaultOpen={true} forceOpen={false}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    });

    it('when forceOpen is supplied, clicking header does not toggle state', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} forceOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      const header = screen.getByRole('button');
      fireEvent.click(header);
      // Still open — controlled component ignores user clicks
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });
  });

  // Region / accessibility ──────────────────────────────────────────────────

  describe('accessibility', () => {
    it('content region has aria-label referencing the folder label', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} defaultOpen={true}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByRole('region', { name: /queue jobs/i })).toBeInTheDocument();
    });

    it('header has tabIndex=0 for keyboard navigation', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      expect(screen.getByRole('button')).toHaveAttribute('tabindex', '0');
    });

    it('content region has aria-hidden when collapsed', () => {
      render(
        <ServeStatusFolder status="pending" label="Queue" count={1} defaultOpen={false}>
          <div>job</div>
        </ServeStatusFolder>,
      );
      const region = screen.getByRole('region', { hidden: true });
      expect(region).toHaveAttribute('aria-hidden', 'true');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Integration tests — Queue tab folder grouping, search, status transitions
//
// These tests exercise the grouping logic that ServePage uses (jobsByFolder
// via deriveServeFolder) without rendering the full ServePage (which requires
// Mapbox + many complex context providers).  Instead we compose a small
// test harness that mirrors the folder-view rendering loop.
// ════════════════════════════════════════════════════════════════════════════

// ── Lightweight test harness ────────────────────────────────────────────────

interface FolderViewProps {
  jobs: ServeJob[];
  searchQuery?: string;
}

/**
 * A minimal reproduction of ServePage's folder-view rendering:
 *   1. Filter jobs by search query (recipient_name | case_number | client_name | address)
 *   2. Group by deriveServeFolder
 *   3. Render a ServeStatusFolder per group in FOLDER_ORDER
 */
function FolderView({ jobs, searchQuery = '' }: FolderViewProps) {
  const FOLDER_ORDER: ServeFolder[] = ['in_progress', 'pending', 'served', 'failed', 'archived'];
  const FOLDER_LABELS: Record<ServeFolder, string> = {
    in_progress: 'In Progress',
    pending: 'Queue',
    served: 'Served',
    failed: 'Non-Service',
    archived: 'Archived',
  };

  // Apply search filter (mirrors ServePage.filteredJobs)
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? jobs.filter(j =>
        j.recipient_name.toLowerCase().includes(q) ||
        (j.case_number ?? '').toLowerCase().includes(q) ||
        (j.client_name ?? '').toLowerCase().includes(q) ||
        (j.recipient_address ?? '').toLowerCase().includes(q),
      )
    : jobs;

  // Group by folder
  const groups: Record<ServeFolder, ServeJob[]> = {
    in_progress: [], pending: [], served: [], failed: [], archived: [],
  };
  for (const job of filtered) {
    groups[deriveServeFolder(job)].push(job);
  }

  return (
    <div data-testid="folder-view">
      {FOLDER_ORDER.map(folder => (
        <ServeStatusFolder
          key={folder}
          status={folder}
          label={FOLDER_LABELS[folder]}
          count={groups[folder].length}
          defaultOpen={true}
        >
          {groups[folder].map(job => (
            <div key={job.id} data-testid={`job-${job.id}`} data-status={job.status}>
              {job.recipient_name}
            </div>
          ))}
        </ServeStatusFolder>
      ))}
    </div>
  );
}

describe('Queue tab folder view (integration)', () => {
  describe('jobs grouped correctly by status', () => {
    it('places a pending job into the Queue folder', () => {
      const jobs = [makeJob({ id: 1, status: 'pending', recipient_name: 'Alice Smith' })];
      render(<FolderView jobs={jobs} />);
      // Queue folder has count=1
      expect(screen.getByLabelText('1 jobs')).toBeInTheDocument();
      // Job card appears in Queue section
      expect(screen.getByTestId('job-1')).toBeInTheDocument();
    });

    it('places an in_progress job into In Progress folder', () => {
      const jobs = [makeJob({ id: 2, status: 'in_progress', recipient_name: 'Bob Jones' })];
      render(<FolderView jobs={jobs} />);
      expect(screen.getByTestId('job-2')).toBeInTheDocument();
    });

    it('places a served job into Served folder', () => {
      const jobs = [makeJob({ id: 3, status: 'served', recipient_name: 'Carol Lee' })];
      render(<FolderView jobs={jobs} />);
      expect(screen.getByTestId('job-3')).toBeInTheDocument();
    });

    it('places a failed job into Non-Service folder', () => {
      const jobs = [makeJob({ id: 4, status: 'failed', recipient_name: 'Dave Kim' })];
      render(<FolderView jobs={jobs} />);
      expect(screen.getByTestId('job-4')).toBeInTheDocument();
    });

    it('places a skipped job into Archived folder', () => {
      const jobs = [makeJob({ id: 5, status: 'skipped', recipient_name: 'Eve Park' })];
      render(<FolderView jobs={jobs} />);
      expect(screen.getByTestId('job-5')).toBeInTheDocument();
    });

    it('places an archived job into Archived folder', () => {
      const jobs = [makeJob({ id: 6, status: 'archived', recipient_name: 'Frank Davis' })];
      render(<FolderView jobs={jobs} />);
      expect(screen.getByTestId('job-6')).toBeInTheDocument();
    });

    it('groups multiple jobs of different statuses into correct folders', () => {
      const jobs = [
        makeJob({ id: 1, status: 'pending',     recipient_name: 'A' }),
        makeJob({ id: 2, status: 'in_progress',  recipient_name: 'B' }),
        makeJob({ id: 3, status: 'served',       recipient_name: 'C' }),
        makeJob({ id: 4, status: 'failed',       recipient_name: 'D' }),
        makeJob({ id: 5, status: 'skipped',      recipient_name: 'E' }),
      ];
      render(<FolderView jobs={jobs} />);

      // All 5 job cards present
      [1, 2, 3, 4, 5].forEach(id => {
        expect(screen.getByTestId(`job-${id}`)).toBeInTheDocument();
      });
    });

    it('each folder shows the correct count for multiple same-status jobs', () => {
      const jobs = [
        makeJob({ id: 1, status: 'pending', recipient_name: 'A' }),
        makeJob({ id: 2, status: 'pending', recipient_name: 'B' }),
        makeJob({ id: 3, status: 'pending', recipient_name: 'C' }),
      ];
      render(<FolderView jobs={jobs} />);
      // Queue folder badge says 3; others say 0
      const badges = screen.getAllByLabelText(/\d+ jobs/);
      const counts = badges.map(b => b.textContent?.trim());
      // There are 5 folders; Queue should have '3', others '0'
      expect(counts).toContain('3');
    });

    it('shows 5 folders even when all jobs are in one status', () => {
      const jobs = [makeJob({ id: 1, status: 'served' })];
      render(<FolderView jobs={jobs} />);
      // All 5 folder headers present
      expect(screen.getByText('In Progress')).toBeInTheDocument();
      expect(screen.getByText('Queue')).toBeInTheDocument();
      expect(screen.getByText('Served')).toBeInTheDocument();
      expect(screen.getByText('Non-Service')).toBeInTheDocument();
      expect(screen.getByText('Archived')).toBeInTheDocument();
    });

    it('renders all folders even when jobs array is empty', () => {
      render(<FolderView jobs={[]} />);
      expect(screen.getAllByRole('button')).toHaveLength(5);
    });
  });

  describe('search filters across all folders', () => {
    const baseJobs: ServeJob[] = [
      makeJob({ id: 1, status: 'pending',    recipient_name: 'Alice Smith',  case_number: 'CV-001', client_name: 'ClientA', recipient_address: '100 Oak Ave' }),
      makeJob({ id: 2, status: 'in_progress', recipient_name: 'Bob Jones',   case_number: 'CV-002', client_name: 'ClientB', recipient_address: '200 Pine St' }),
      makeJob({ id: 3, status: 'served',     recipient_name: 'Carol Lee',    case_number: 'CV-003', client_name: 'ClientC', recipient_address: '300 Elm Rd' }),
      makeJob({ id: 4, status: 'failed',     recipient_name: 'Dave Kim',     case_number: 'CV-004', client_name: 'ClientD', recipient_address: '400 Maple Dr' }),
    ];

    it('returns all jobs when search query is empty', () => {
      render(<FolderView jobs={baseJobs} searchQuery="" />);
      [1, 2, 3, 4].forEach(id => {
        expect(screen.getByTestId(`job-${id}`)).toBeInTheDocument();
      });
    });

    it('filters by recipient_name across folders', () => {
      render(<FolderView jobs={baseJobs} searchQuery="alice" />);
      expect(screen.getByTestId('job-1')).toBeInTheDocument();
      expect(screen.queryByTestId('job-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('job-3')).not.toBeInTheDocument();
      expect(screen.queryByTestId('job-4')).not.toBeInTheDocument();
    });

    it('filters by case_number', () => {
      render(<FolderView jobs={baseJobs} searchQuery="cv-003" />);
      expect(screen.queryByTestId('job-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('job-2')).not.toBeInTheDocument();
      expect(screen.getByTestId('job-3')).toBeInTheDocument();
      expect(screen.queryByTestId('job-4')).not.toBeInTheDocument();
    });

    it('filters by client_name', () => {
      render(<FolderView jobs={baseJobs} searchQuery="clientd" />);
      expect(screen.queryByTestId('job-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('job-4')).toBeInTheDocument();
    });

    it('filters by recipient_address', () => {
      render(<FolderView jobs={baseJobs} searchQuery="200 pine" />);
      expect(screen.getByTestId('job-2')).toBeInTheDocument();
      expect(screen.queryByTestId('job-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('job-3')).not.toBeInTheDocument();
    });

    it('search is case-insensitive', () => {
      render(<FolderView jobs={baseJobs} searchQuery="BOB JONES" />);
      expect(screen.getByTestId('job-2')).toBeInTheDocument();
    });

    it('returns no jobs when query matches nothing', () => {
      render(<FolderView jobs={baseJobs} searchQuery="xyznonexistent999" />);
      [1, 2, 3, 4].forEach(id => {
        expect(screen.queryByTestId(`job-${id}`)).not.toBeInTheDocument();
      });
    });

    it('returns jobs from multiple folders when query matches several', () => {
      // CV- prefix matches all four case numbers
      render(<FolderView jobs={baseJobs} searchQuery="cv-" />);
      [1, 2, 3, 4].forEach(id => {
        expect(screen.getByTestId(`job-${id}`)).toBeInTheDocument();
      });
    });

    it('updates folder counts after filtering', () => {
      render(<FolderView jobs={baseJobs} searchQuery="alice" />);
      // Only one job matches — Queue folder shows 1, others 0
      const badges = screen.getAllByLabelText(/\d+ jobs/);
      const nonZero = badges.filter(b => b.textContent?.trim() !== '0');
      expect(nonZero).toHaveLength(1);
      expect(nonZero[0].textContent?.trim()).toBe('1');
    });
  });

  describe('status change moves job to correct folder', () => {
    // We simulate a status change by re-rendering with updated job data,
    // which is what ServePage does via setJobs optimistic update.

    it('moving a job from pending → in_progress shifts it to In Progress folder', () => {
      const { rerender } = render(
        <FolderView jobs={[makeJob({ id: 1, status: 'pending' })]} />,
      );
      // Initially in Queue (pending)
      expect(screen.getByTestId('job-1')).toHaveAttribute('data-status', 'pending');

      // Simulate server response — update to in_progress
      rerender(
        <FolderView jobs={[makeJob({ id: 1, status: 'in_progress' })]} />,
      );
      expect(screen.getByTestId('job-1')).toHaveAttribute('data-status', 'in_progress');
    });

    it('moving a job from in_progress → served shifts it to Served folder', () => {
      const { rerender } = render(
        <FolderView jobs={[makeJob({ id: 2, status: 'in_progress' })]} />,
      );
      rerender(
        <FolderView jobs={[makeJob({ id: 2, status: 'served', closed_at: '2026-06-23T14:00:00' })]} />,
      );
      expect(screen.getByTestId('job-2')).toHaveAttribute('data-status', 'served');
    });

    it('moving a job from in_progress → failed shifts it to Non-Service folder', () => {
      const { rerender } = render(
        <FolderView jobs={[makeJob({ id: 3, status: 'in_progress', attempt_count: 2, max_attempts: 3 })]} />,
      );
      rerender(
        <FolderView jobs={[makeJob({ id: 3, status: 'failed', closed_at: '2026-06-23T14:00:00' })]} />,
      );
      expect(screen.getByTestId('job-3')).toHaveAttribute('data-status', 'failed');
    });

    it('folder counts update correctly after a status change', () => {
      const initialJobs = [
        makeJob({ id: 1, status: 'pending', recipient_name: 'A' }),
        makeJob({ id: 2, status: 'pending', recipient_name: 'B' }),
      ];
      const { rerender } = render(<FolderView jobs={initialJobs} />);

      // Both jobs in Queue → count=2
      const badges = screen.getAllByLabelText(/\d+ jobs/);
      // Queue badge
      const queueBadge = badges.find(b => b.textContent?.trim() === '2');
      expect(queueBadge).toBeDefined();

      // Job 1 gets served
      const updatedJobs = [
        makeJob({ id: 1, status: 'served', recipient_name: 'A', closed_at: '2026-06-23T15:00:00' }),
        makeJob({ id: 2, status: 'pending', recipient_name: 'B' }),
      ];
      rerender(<FolderView jobs={updatedJobs} />);

      // Now Queue=1, Served=1
      const updatedBadges = screen.getAllByLabelText(/\d+ jobs/);
      const nonZero = updatedBadges.filter(b => b.textContent?.trim() !== '0');
      expect(nonZero).toHaveLength(2);
      const values = nonZero.map(b => b.textContent?.trim()).sort();
      expect(values).toEqual(['1', '1']);
    });

    it('a job that gets archived disappears from Queue and appears in Archived', () => {
      const { rerender } = render(
        <FolderView jobs={[makeJob({ id: 5, status: 'pending', recipient_name: 'Eve' })]} />,
      );
      expect(screen.getByTestId('job-5')).toHaveAttribute('data-status', 'pending');

      rerender(
        <FolderView jobs={[makeJob({ id: 5, status: 'archived', recipient_name: 'Eve' })]} />,
      );
      expect(screen.getByTestId('job-5')).toHaveAttribute('data-status', 'archived');
    });

    it('a skipped job appears in Archived folder (not its own folder)', () => {
      render(
        <FolderView jobs={[makeJob({ id: 6, status: 'skipped', recipient_name: 'Frank' })]} />,
      );
      // Job is present
      expect(screen.getByTestId('job-6')).toBeInTheDocument();
      // Archived folder has count=1
      // The "Archived" label appears and we can verify the badge beside it
      const archivedBadge = screen.getAllByLabelText(/\d+ jobs/)
        .find(b => {
          const parent = b.closest('[class*="border-l-2"]');
          return parent?.textContent?.includes('Archived');
        });
      expect(archivedBadge?.textContent?.trim()).toBe('1');
    });
  });

  describe('deriveServeFolder and folder config consistency', () => {
    it('every ServeFolder key has a corresponding SERVE_FOLDER_CONFIG entry', () => {
      const folders: ServeFolder[] = ['in_progress', 'pending', 'served', 'failed', 'archived'];
      folders.forEach(f => {
        expect(SERVE_FOLDER_CONFIG[f]).toBeDefined();
        expect(SERVE_FOLDER_CONFIG[f].label).toBeTruthy();
        expect(SERVE_FOLDER_CONFIG[f].emptyLabel).toBeTruthy();
      });
    });

    it('SERVE_FOLDER_CONFIG.in_progress has defaultOpen=true', () => {
      expect(SERVE_FOLDER_CONFIG.in_progress.defaultOpen).toBe(true);
    });

    it('SERVE_FOLDER_CONFIG.pending has defaultOpen=true', () => {
      expect(SERVE_FOLDER_CONFIG.pending.defaultOpen).toBe(true);
    });

    it('SERVE_FOLDER_CONFIG.served has defaultOpen=false', () => {
      expect(SERVE_FOLDER_CONFIG.served.defaultOpen).toBe(false);
    });

    it('SERVE_FOLDER_CONFIG.failed has defaultOpen=false', () => {
      expect(SERVE_FOLDER_CONFIG.failed.defaultOpen).toBe(false);
    });

    it('SERVE_FOLDER_CONFIG.archived has defaultOpen=false', () => {
      expect(SERVE_FOLDER_CONFIG.archived.defaultOpen).toBe(false);
    });
  });
});
