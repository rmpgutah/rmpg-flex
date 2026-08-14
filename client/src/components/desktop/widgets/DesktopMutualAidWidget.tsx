import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface DispatchUnit {
  id: number | string;
  unit_id?: string;
  unit?: string;
  agency?: string;
  agency_id?: string;
  status?: string;
}

interface AgencyGroup {
  agency: string;
  count: number;
}

function isMutualAid(u: DispatchUnit): boolean {
  const uid = (u.unit_id ?? u.unit ?? '').toUpperCase();
  const agency = (u.agency ?? u.agency_id ?? '').toUpperCase();
  // Units not from RMPG are mutual aid
  if (agency && agency !== 'RMPG') return true;
  if (!agency && !uid.startsWith('RMPG')) return true;
  return false;
}

function agencyLabel(u: DispatchUnit): string {
  const ag = u.agency ?? u.agency_id;
  if (ag) return ag;
  const uid = (u.unit_id ?? u.unit ?? 'Unknown').replace(/[0-9]/g, '').trim();
  return uid || 'Partner';
}

export default function DesktopMutualAidWidget() {
  const [groups, setGroups] = useState<AgencyGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchUnits = useCallback(async () => {
    try {
      const resp = await apiFetch<{ data: DispatchUnit[] } | DispatchUnit[]>(
        '/dispatch/units?status=active&limit=100',
      );
      const rows: DispatchUnit[] = Array.isArray(resp) ? resp : ((resp as { data: DispatchUnit[] }).data ?? []);
      const aid = rows.filter(isMutualAid);
      const byAgency = new Map<string, number>();
      for (const u of aid) {
        const ag = agencyLabel(u);
        byAgency.set(ag, (byAgency.get(ag) ?? 0) + 1);
      }
      const sorted: AgencyGroup[] = [...byAgency.entries()]
        .map(([agency, count]) => ({ agency, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      setGroups(sorted);
      setTotal(aid.length);
    } catch {
      // silently retain previous data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnits();
    const iv = setInterval(fetchUnits, 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchUnits]);

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        padding: '10px 14px',
        width: 200,
        minHeight: 90,
      }}
    >
      {loading ? (
        <div>
          <div style={{ background: 'var(--surface-base)', borderRadius: 2, height: 28, width: 50, marginBottom: 8 }} />
          <div style={{ background: 'var(--surface-base)', borderRadius: 2, height: 10, width: 140 }} />
        </div>
      ) : total === 0 ? (
        <>
          <div className="font-mono font-bold" style={{ fontSize: 24, color: 'var(--text-secondary)', lineHeight: 1 }}>
            0
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 4 }}>No mutual aid active</div>
        </>
      ) : (
        <>
          <div className="font-mono font-bold" style={{ fontSize: 28, color: 'var(--text-primary)', lineHeight: 1 }}>
            {total}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginTop: 2, marginBottom: 6 }}>
            {total === 1 ? 'unit' : 'units'} from partner agencies
          </div>
          {groups.map(g => (
            <div key={g.agency} className="flex items-center justify-between" style={{ marginBottom: 3 }}>
              <span style={{ color: 'var(--text-primary)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {g.agency}
              </span>
              <span
                style={{
                  background: 'var(--surface-base)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 2,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '0 5px',
                  color: 'var(--text-primary)',
                  marginLeft: 6,
                  flexShrink: 0,
                }}
              >
                {g.count}
              </span>
            </div>
          ))}
          <button
            style={{
              marginTop: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--accent-silver-400)',
              fontSize: 10,
              padding: 0,
            }}
            onClick={() => {}}
          >
            View details →
          </button>
        </>
      )}
      <div className="text-[9px] font-semibold uppercase tracking-wider mt-2" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
        Mutual Aid Status
      </div>
    </div>
  );
}
