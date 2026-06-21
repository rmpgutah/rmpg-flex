import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';

interface CostRow { id: number; cost?: number | null; amount?: number | null; cost_date?: string | null; date?: string | null; description?: string | null; vendor?: string | null; }

export function CostsTab({ vehicleId }: { vehicleId: number }) {
  const [insurance, setInsurance] = useState<CostRow[]>([]);
  const [loans, setLoans] = useState<CostRow[]>([]);
  const [accessories, setAccessories] = useState<CostRow[]>([]);
  const [other, setOther] = useState<CostRow[]>([]);
  const [costPerMile, setCostPerMile] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      apiFetch<CostRow[]>(`/fleet/${vehicleId}/insurance`),
      apiFetch<CostRow[]>(`/fleet/${vehicleId}/loans`),
      apiFetch<CostRow[]>(`/fleet/${vehicleId}/accessories`),
      apiFetch<CostRow[]>(`/fleet/${vehicleId}/other-costs`),
      apiFetch<{ cost_per_mile?: number }>(`/fleet/cost-per-mile/${vehicleId}`),
    ]).then(([i, l, a, o, cpm]) => {
      if (cancelled) return;
      const arrayOrEmpty = (r: PromiseSettledResult<CostRow[]>): CostRow[] =>
        r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [];
      setInsurance(arrayOrEmpty(i));
      setLoans(arrayOrEmpty(l));
      setAccessories(arrayOrEmpty(a));
      setOther(arrayOrEmpty(o));
      if (cpm.status === 'fulfilled' && cpm.value && typeof cpm.value.cost_per_mile === 'number') {
        setCostPerMile(cpm.value.cost_per_mile);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading costs…</div>;

  const sections: { title: string; rows: CostRow[] }[] = [
    { title: 'Insurance', rows: insurance },
    { title: 'Loans', rows: loans },
    { title: 'Accessories', rows: accessories },
    { title: 'Other costs', rows: other },
  ];
  const allEmpty = sections.every((s) => s.rows.length === 0) && costPerMile == null;
  if (allEmpty) return <div className="p-4 text-sm text-rmpg-400">No costs recorded for this vehicle.</div>;

  return (
    <div className="p-4 space-y-4">
      {costPerMile != null ? (
        <div className="rounded-sm border border-rmpg-700 bg-surface-raised px-3 py-2 text-[11px]">
          <span className="text-rmpg-400">Cost / mile · </span>
          <span className="text-rmpg-100 font-semibold">${costPerMile.toFixed(2)}</span>
        </div>
      ) : null}
      {sections.filter((s) => s.rows.length > 0).map((s) => (
        <section key={s.title}>
          <h3 className="text-[10px] uppercase tracking-wide text-rmpg-400 font-semibold mb-1">{s.title}</h3>
          <ul className="space-y-1">
            {s.rows.map((r) => (
              <li key={r.id} className="border border-rmpg-700 bg-surface-raised rounded-sm px-2 py-1 text-[11px] flex items-baseline justify-between">
                <span className="text-rmpg-100">{r.description ?? r.vendor ?? `#${r.id}`}</span>
                <span className="text-rmpg-300">{(r.cost ?? r.amount) != null ? `$${Number(r.cost ?? r.amount).toFixed(2)}` : '—'}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
