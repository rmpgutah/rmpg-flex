// ============================================================
// MyRunTab — the end-of-run banner must not celebrate a bad run
// ============================================================
// The banner was unconditionally green + Trophy + "Run Complete!". It
// computed `successRate` purely to print it and never let it affect the
// styling, so a shift that served nobody got the same trophy as a perfect
// one. Observed live: a gold trophy and a green celebration over
// "0/1 served (0% success rate)", where the single job was a non-service.
//
// The rule these tests pin: only a strong day celebrates. Everything else
// is acknowledged neutrally — never scolded, because in process serving a
// documented non-service is a legitimate, diligent, billable outcome.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
  authedImageUrl: (u: string) => u,
}));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));

import { __testables } from '../MyRunTab';

const { runTone, CompletionBanner } = __testables;

describe('runTone bands', () => {
  it('celebrates only a strong day', () => {
    expect(runTone(100).title).toBe('Run Complete!');
    expect(runTone(100).accent).toBe('green');
    expect(runTone(80).accent).toBe('green');
  });

  it('acknowledges an ordinary day without praising it', () => {
    expect(runTone(79).accent).toBe('silver');
    expect(runTone(79).title).toBe('Run Complete');
    expect(runTone(40).title).toBe('Run Complete');
  });

  // The case that prompted the change.
  it('states the fact for a low-yield day instead of congratulating', () => {
    expect(runTone(0).title).toBe('Run Closed Out');
    expect(runTone(0).accent).toBe('silver');
    expect(runTone(39).title).toBe('Run Closed Out');
  });

  it('never renders red — a slow serve day is not a safety event', () => {
    for (const r of [0, 10, 39, 40, 79, 80, 100]) {
      expect(['green', 'silver', 'amber']).toContain(runTone(r).accent);
    }
  });

  it('varies the icon with the band, so a trophy cannot sit over a closed-out run', () => {
    expect(runTone(100).icon).not.toBe(runTone(0).icon);
    expect(runTone(50).icon).not.toBe(runTone(100).icon);
  });
});

describe('CompletionBanner', () => {
  it('shows no green celebration when nothing was served', () => {
    const { container } = render(
      <CompletionBanner startedAt={null} served={0} total={1} />,
    );
    expect(screen.getByText('Run Closed Out')).toBeTruthy();
    expect(screen.getByText(/0\/1 served \(0% success rate\)/)).toBeTruthy();
    expect(container.querySelector('[class*="green"]')).toBeNull();
  });

  it('celebrates a fully-served run', () => {
    render(<CompletionBanner startedAt={null} served={4} total={4} />);
    expect(screen.getByText('Run Complete!')).toBeTruthy();
    expect(screen.getByText(/4\/4 served \(100% success rate\)/)).toBeTruthy();
  });

  it('treats an empty run as 0% rather than dividing by zero', () => {
    render(<CompletionBanner startedAt={null} served={0} total={0} />);
    expect(screen.getByText(/0% success rate/)).toBeTruthy();
  });
});
