// Intel BOLO board data hook. Thin wrapper over the EXISTING /comms/bolos
// router (list/create/update/delete). No new backend.
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';

export interface Bolo {
  id: number; bolo_number: string; type: string; status: string; title: string;
  description: string | null; subject_description: string | null; vehicle_description: string | null;
  photo_url: string | null; priority: string; issued_by: number; issued_by_name: string | null;
  expires_at: string | null; created_at: string;
}

export interface BoloCreate {
  type: string; title: string; description?: string; subject_description?: string;
  vehicle_description?: string; priority?: string; expires_at?: string;
}

export function useBolos() {
  const [bolos, setBolos] = useState<Bolo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    apiFetch<Bolo[]>('/comms/bolos')
      .then((r) => { setBolos(Array.isArray(r) ? r : []); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load BOLOs'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  const create = useCallback(async (payload: BoloCreate) => {
    await apiFetch('/comms/bolos', { method: 'POST', body: JSON.stringify(payload) });
    reload();
  }, [reload]);

  const resolve = useCallback(async (id: number) => {
    await apiFetch(`/comms/bolos/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
    reload();
  }, [reload]);

  const remove = useCallback(async (id: number) => {
    await apiFetch(`/comms/bolos/${id}`, { method: 'DELETE' });
    reload();
  }, [reload]);

  return { bolos, loading, error, reload, create, resolve, remove };
}
