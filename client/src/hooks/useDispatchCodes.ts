// ============================================================
// RMPG Flex — Dispatch Codes Hook
// Provides access to 10-codes, signal codes, and penal codes
// for dispatch operations. Caches codes for fast lookup.
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from './useApi';

export interface DispatchCode {
  id: number;
  code: string;
  description: string;
  category: string;
  priority: string;
  color: string;
  requires_backup: number;
  officer_safety: number;
  ems_needed: number;
  fire_needed: number;
  notes?: string;
  active: number;
}

interface UseDispatchCodesReturn {
  codes: DispatchCode[];
  loading: boolean;
  lookup: (code: string) => DispatchCode | undefined;
  search: (query: string) => DispatchCode[];
  byCategory: (cat: string) => DispatchCode[];
  reload: () => void;
}

export function useDispatchCodes(): UseDispatchCodesReturn {
  const [codes, setCodes] = useState<DispatchCode[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<DispatchCode[]>('/dispatch/geography/codes');
      if (result) setCodes(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // O(1) lookup map
  const codeMap = useMemo(() => {
    const m = new Map<string, DispatchCode>();
    for (const c of codes) m.set(c.code.toLowerCase(), c);
    return m;
  }, [codes]);

  const lookup = useCallback((code: string) => codeMap.get(code.toLowerCase()), [codeMap]);

  const search = useCallback((query: string) => {
    const q = query.toLowerCase();
    return codes.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [codes]);

  const byCategory = useCallback((cat: string) => {
    return codes.filter(c => c.category === cat);
  }, [codes]);

  return { codes, loading, lookup, search, byCategory, reload: load };
}
