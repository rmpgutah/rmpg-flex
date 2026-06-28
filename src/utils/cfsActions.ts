// Pure CFS action planner — the executor half of the Action Bus. The iOS
// CfsActionLibrary defines 100+ named actions, each carrying a verb + params;
// this maps a verb to concrete calls_for_service column updates + a narrative /
// audit line. Dependency-free → vitest without a D1 binding. The route handler
// (dispatch/calls.ts POST /:id/action) persists what this returns.

export const CFS_VERBS = [
  'status', 'priority', 'disposition', 'unit', 'resource',
  'link', 'flag', 'narrative', 'timer', 'notify', 'query',
] as const;
export type CfsVerb = (typeof CFS_VERBS)[number];

const STATUS_VALUES = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
const STATUS_TIME: Record<string, string> = {
  dispatched: 'dispatched_at', enroute: 'enroute_at', onscene: 'onscene_at',
  cleared: 'cleared_at', closed: 'closed_at', archived: 'archived_at',
};

export interface CfsActionPlan {
  verb: CfsVerb;
  updates: Record<string, unknown>;                    // direct calls_for_service column sets
  setTimes: string[];                                  // *_at columns to COALESCE(now)
  narrative: string;                                   // human audit line (always present)
  link?: { entity_type: string; entity_id: number };   // junction insert (when an id is supplied)
}

export function isCfsVerb(v: unknown): v is CfsVerb {
  return typeof v === 'string' && (CFS_VERBS as readonly string[]).includes(v);
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function unitsList(call: Record<string, unknown>): string[] {
  return String(call.unit_call_signs ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function planAction(
  call: Record<string, unknown>,
  action: string,
  verb: CfsVerb,
  params: Record<string, unknown>,
): CfsActionPlan | { error: string } {
  const p = params || {};
  const plan: CfsActionPlan = { verb, updates: {}, setTimes: [], narrative: '' };

  switch (verb) {
    case 'status': {
      const to = String(p.to ?? '').toLowerCase();
      if (!STATUS_VALUES.includes(to)) return { error: `invalid status "${to}"` };
      plan.updates.status = to;
      if (STATUS_TIME[to]) plan.setTimes.push(STATUS_TIME[to]);
      plan.narrative = `Status → ${to}`;
      return plan;
    }
    case 'priority': {
      let pr = num(p.to);
      // call.priority is stored as the TEXT 'P1'..'P4'; strip the leading P
      // before reading the current value so delta (Escalate/De-escalate)
      // computes off the real priority instead of always assuming 3.
      if (p.delta != null) pr = (num(String(call.priority ?? '').replace(/^P/i, '')) ?? 3) + (num(p.delta) ?? 0);
      if (pr == null || pr < 1 || pr > 4) return { error: 'priority must be 1–4' };
      // calls_for_service.priority is CHECK(priority IN ('P1','P2','P3','P4')),
      // so the persisted value MUST be the canonical 'P{n}' string, not a number.
      plan.updates.priority = `P${pr}`;
      plan.narrative = `Priority → P${pr}`;
      return plan;
    }
    case 'disposition': {
      const code = String(p.code ?? p.to ?? '').trim();
      if (!code) return { error: 'disposition code required' };
      plan.updates.disposition = code;
      plan.narrative = `Disposition: ${String(p.label ?? code)}`;
      return plan;
    }
    case 'unit': {
      const op = String(p.op ?? 'add');
      const unit = String(p.unit ?? '').trim();
      let list = unitsList(call);
      if (op === 'remove') {
        list = list.filter((u) => u !== unit);
        plan.narrative = `Unit removed: ${unit || '—'}`;
      } else if (op === 'set') {
        list = unit ? [unit] : [];
        plan.narrative = `Primary unit: ${unit || '—'}`;
      } else {
        if (unit && !list.includes(unit)) list.push(unit);
        plan.narrative = p.note ? String(p.note) : `Unit added: ${unit || '—'}`;
      }
      plan.updates.unit_call_signs = list.join(', ');
      return plan;
    }
    case 'resource': {
      plan.narrative = `Requested ${String(p.resource ?? 'resource')}`;
      return plan;
    }
    case 'link': {
      const et = String(p.entity_type ?? '');
      if (!et) return { error: 'entity_type required' };
      const eid = num(p.entity_id);
      if (eid != null) plan.link = { entity_type: et, entity_id: eid };
      plan.narrative = `Linked ${et}${eid != null ? ` #${eid}` : ''}`;
      return plan;
    }
    case 'flag': {
      const f = String(p.flag ?? p.label ?? 'hazard');
      plan.narrative = p.clear ? `Cleared hazard: ${f}` : `⚠ HAZARD: ${f}`;
      return plan;
    }
    case 'narrative': {
      const t = String(p.text ?? p.label ?? '').trim();
      if (!t) return { error: 'narrative text required' };
      plan.narrative = t;
      return plan;
    }
    case 'timer': {
      plan.narrative = `Timer: ${String(p.label ?? p.kind ?? 'started')}`;
      return plan;
    }
    case 'notify': {
      plan.narrative = `Notify: ${String(p.label ?? p.target ?? 'dispatch')}`;
      return plan;
    }
    case 'query': {
      plan.narrative = `Query: ${String(p.label ?? p.kind ?? 'lookup')}`;
      return plan;
    }
    default:
      return { error: `unknown verb "${String(verb)}"` };
  }
}
