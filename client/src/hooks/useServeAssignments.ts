// client/src/hooks/useServeAssignments.ts
import { useState, useCallback } from 'react';
import { apiFetch } from './useApi';

export interface BoardJob { id: number; status: string; officer_id: number | null; deadline: string | null; priority: string; defendant_name?: string; recipient_name?: string; recipient_address?: string; case_number?: string; attention: string[]; }
export interface BoardOfficer { id: number; name: string; count: number; attention: Record<string, number>; }
export interface Board { officers: BoardOfficer[]; unassigned: BoardJob[]; byOfficer: Record<string, BoardJob[]>; }

export function useServeAssignments() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const loadBoard = useCallback(async () => {
    setLoading(true);
    try { setBoard(await apiFetch<Board>('/process-server/assignments/board')); }
    catch { setBoard(null); }
    setLoading(false);
  }, []);
  const assign = useCallback(async (jobIds: number[], officerId: number | null, reason?: string) => {
    await apiFetch('/process-server/assignments/assign', { method: 'POST', body: JSON.stringify({ job_ids: jobIds, officer_id: officerId, reason }) });
  }, []);
  return { board, loading, loadBoard, assign };
}
