import { useEffect, useState } from 'react';
import { apiFetchV2 } from '../hooks/apiFetchV2';

interface CostRow { id: number; cost?: number | null; amount?: number | null; cost_date?: string | null; date?: string | null; description?: string | null; vendor?: string | null; }

export function CostsTab({ vehicleId }: { vehicleId: number }) {
  const [insurance, setInsurance] = useState<CostRow[]>([]);
  const [loans, setLoans] = useState<CostRow[]>([]);
  const [accessories, setAccessories] = useState<CostRow[]>([]);
  const [other, setOther] = useState<CostRow[]>([]);
  const [costPerMile, setCostPerMile] = useState<number | null>(null);
  const [failedCategories, setFailedCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      apiFetchV2<CostRow[]>(`/fleet/${vehicleId}/insurance`),
      apiFetchV2<CostRow[]>(`/fleet/${vehicleId}/loans`),
      apiFetchV2<CostRow[]>(`/fleet/${vehicleId}/accessories`),
      apiFetchV2<CostRow[]>(`/fleet/${vehicleId}/other-costs`),
      apiFetchV2<{ cost_per_mile?: number }>(`/fleet/cost-per-mile/${vehicleId}`),
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
      const failed: string[] = [];
      if (i.status === 'rejected') failed.push('Insurance');
      if (l.status === 'rejected') failed.push('Loans');
      if (a.status === 'rejected') failed.push('Accessories');
      if (o.status === 'rejected') failed.push('Other costs');
      if (cpm.status === 'rejected') failed.push('Cost per mile');
      setFailedCategories(failed);
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
  if (allEmpty && failedCategories.length === 0) {
    return <div className="p-4 text-sm text-rmpg-400">No costs recorded for this vehicle.</div>;
  }

  return (
    <div className="p-4 space-y-4">
      {failedCategories.length > 0 ? (
        <div className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          Couldn't load: {failedCategories.join(', ')}. Other sections below may be incomplete.
        </div>
      ) : null}
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
