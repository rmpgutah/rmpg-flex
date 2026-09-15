// ============================================================
// Dispatcher Command Engine — deterministic intent rules
// ============================================================
// Regex matcher for the phrasings dispatchers actually use most. Runs BEFORE
// the LLM so (a) the common path is instant and free, and (b) the engine
// keeps working when every AI provider is down. Pure: text in, tool calls
// out, or null when nothing matched (→ planner.ts takes over).
//
// Call references are left as the user typed them ("42", "0042",
// "CFS26-0042", "that call", "this one"); resolve.ts turns them into ids.

import type { PlannerOutput, ToolCall } from './types';

const CALL = String.raw`(?:call\s*|cfs\s*|#\s*)?([a-z]{0,4}\d[\w-]*|this call|that call|this one|that one|selected call|current call)`;
const UNIT_CORE = String.raw`[a-z]{0,3}\d{1,4}[a-z]?|[a-z]+\d+`;
const UNIT = String.raw`(?:unit\s+)?(${UNIT_CORE})`;
const UNIT_LIST = String.raw`((?:(?:unit\s+)?(?:${UNIT_CORE})(?:\s*(?:,|\band\b|&)\s*|\s+)?)+)`;

const UNIT_STATUS_WORDS: Array<[RegExp, string]> = [
  [/\b(on ?scene|arrived|10-?23|10-?97|out at)\b/, 'onscene'],
  [/\b(en ?route|responding|10-?76|10-?51)\b/, 'enroute'],
  [/\b(available|in service|10-?8|clear(?:ed)?|code ?4)\b/, 'available'],
  [/\b(out of service|10-?7|oos)\b/, 'out_of_service'],
  [/\b(off duty|end of shift|10-?42)\b/, 'off_duty'],
  [/\b(busy|tied up|10-?6)\b/, 'busy'],
  [/\b(dispatched)\b/, 'dispatched'],
];

const CALL_STATUS_WORDS: Array<[RegExp, string]> = [
  [/\b(clear|cleared|close|closed)\b/, 'cleared'],
  [/\b(cancel|cancelled|canceled)\b/, 'cancelled'],
  [/\b(pending|reopen)\b/, 'pending'],
];

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/[^\w\s#:,&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function priorityOf(s: string): 'P1' | 'P2' | 'P3' | 'P4' | null {
  const m = /\b(?:p|priority)\s*-?\s*([1-4])\b/.exec(s);
  if (m) return `P${m[1]}` as 'P1' | 'P2' | 'P3' | 'P4';
  if (/\bcode\s*3\b/.test(s)) return 'P1';
  return null;
}

function splitUnits(list: string): string[] {
  return list
    .split(/\s*(?:,|\band\b|&)\s*|\s+/)
    .map(s => s.replace(/^unit\s+/, '').trim())
    .filter(Boolean)
    .map(s => s.toUpperCase());
}

function out(intent: string, reply: string, tool_calls: ToolCall[]): PlannerOutput {
  return { intent, reply, tool_calls };
}

/**
 * Match one utterance against the rule set. Returns null when no rule fires.
 * Order matters: more specific patterns first.
 */
export function matchRules(rawText: string): PlannerOutput | null {
  const t = norm(rawText);
  if (!t) return null;
  let m: RegExpExecArray | null;

  // HELP
  if (/^(help|\?|what can you do|commands?)$/.test(t)) return out('help', '', [{ tool: 'help', params: {} }]);

  // ASSIGN / DISPATCH units to call:  "assign 12 to 42", "send 12 and 14 to call 42", "dispatch 12 on 42"
  m = new RegExp(String.raw`^(?:assign|dispatch|send|put|start|add|attach)\s+${UNIT_LIST}\s+(?:to|on|for)\s+${CALL}$`).exec(t);
  if (m) return out('assign_units', '', [{ tool: 'assign_units', params: { units: splitUnits(m[1]), call: m[2] } }]);
  // "42 assign 12"  /  "dispatch 42 12 14"
  m = new RegExp(String.raw`^(?:assign|dispatch)\s+${CALL}\s+(?:to\s+)?${UNIT_LIST}$`).exec(t);
  if (m) return out('assign_units', '', [{ tool: 'assign_units', params: { call: m[1], units: splitUnits(m[2]) } }]);

  // UNASSIGN
  m = new RegExp(String.raw`^(?:unassign|remove|drop|pull|take)\s+${UNIT}\s+(?:from|off)\s+${CALL}$`).exec(t);
  if (m) return out('unassign_unit', '', [{ tool: 'unassign_unit', params: { unit: m[1].toUpperCase(), call: m[2] } }]);

  // CLEAR / CLOSE / CANCEL call [disposition]
  m = new RegExp(String.raw`^(clear|close|cancel)\s+${CALL}(?:\s+(?:as|with|disposition|disp|-)?\s*(.+))?$`).exec(t);
  if (m) {
    const status = CALL_STATUS_WORDS.find(([re]) => re.test(m![1]))?.[1] ?? 'cleared';
    const disposition = m[3]?.trim().replace(/\s+/g, '_');
    return out('set_call_status', '', [{ tool: 'set_call_status', params: { call: m[2], status, ...(disposition ? { disposition } : {}) } }]);
  }

  // HOLD / RESUME
  m = new RegExp(String.raw`^(?:hold|put)\s+${CALL}(?:\s+on hold)?$`).exec(t);
  if (m) return out('hold_call', '', [{ tool: 'hold_call', params: { call: m[1] } }]);
  m = new RegExp(String.raw`^(?:resume|unhold|release|take)\s+${CALL}(?:\s+off hold)?$`).exec(t);
  if (m) return out('resume_call', '', [{ tool: 'resume_call', params: { call: m[1] } }]);

  // PRIORITY:  "priority 1 on 42", "make 42 P1", "set 42 to priority 2", "escalate 42 to p1"
  m = new RegExp(String.raw`^(?:set\s+|make\s+|change\s+|escalate\s+|upgrade\s+|downgrade\s+)?(?:priority\s*-?\s*([1-4])|p([1-4]))\s+(?:on|for|to)?\s*${CALL}$`).exec(t);
  if (m) return out('set_priority', '', [{ tool: 'set_priority', params: { call: m[3], priority: `P${m[1] || m[2]}` } }]);
  m = new RegExp(String.raw`^(?:set|make|change|escalate|upgrade|downgrade)\s+${CALL}\s+(?:to\s+)?(?:priority\s*-?\s*([1-4])|p([1-4]))$`).exec(t);
  if (m) return out('set_priority', '', [{ tool: 'set_priority', params: { call: m[1], priority: `P${m[2] || m[3]}` } }]);

  // NOTE:  "note on 42: subject left", "add note 42 subject left", "note 42 …"
  m = new RegExp(String.raw`^(?:add\s+)?(?:a\s+)?(?:note|narrative|nt)\s+(?:on|to|for)?\s*${CALL}\s*[:,-]?\s+(.+)$`, 'i').exec(rawText.trim().replace(/\s+/g, ' '));
  if (m) return out('add_note', '', [{ tool: 'add_note', params: { call: m[1].toLowerCase(), text: m[2].trim() } }]);

  // UNIT STATUS:  "put 12 on scene", "show 12 available", "12 is en route", "mark 12 10-8", "12 10-7"
  m = new RegExp(String.raw`^(?:put|show|mark|set|make|status)?\s*${UNIT}\s+(?:is\s+|to\s+|as\s+|status\s+)?(.+)$`).exec(t);
  if (m) {
    const status = UNIT_STATUS_WORDS.find(([re]) => re.test(m![2]))?.[1];
    if (status && !/\b(to|on|for)\s+(call|cfs)\b/.test(m[2])) {
      return out('set_unit_status', '', [{ tool: 'set_unit_status', params: { unit: m[1].toUpperCase(), status } }]);
    }
  }

  // NEW CALL:  "new call alarm at 123 main st", "create a call for suspicious person at 5th and main priority 2"
  m = /^(?:new|create|start|open|enter|log)\s+(?:a\s+)?(?:new\s+)?call\s+(?:for\s+|of\s+|type\s+)?(.+?)\s+(?:at|@|on|near)\s+(.+)$/.exec(t);
  if (m) {
    let type = m[1].trim();
    let addr = m[2].trim();
    const pri = priorityOf(addr) || priorityOf(type);
    addr = addr.replace(/\b(?:p|priority)\s*-?\s*[1-4]\b/g, '').replace(/\bcode\s*3\b/g, '').trim().replace(/[,\s]+$/, '');
    type = type.replace(/\b(?:p|priority)\s*-?\s*[1-4]\b/g, '').trim().replace(/\s+/g, '_');
    return out('create_call', '', [{ tool: 'create_call', params: { incident_type: type, location_address: addr, ...(pri ? { priority: pri } : {}) } }]);
  }
  m = /^(?:new|create|start|open|enter|log)\s+(?:a\s+)?(?:new\s+)?call(?:\s+(?:for\s+)?(.+))?$/.exec(t);
  if (m) return out('open_new_call', '', [{ tool: 'open_new_call', params: m[1] ? { incident_type: m[1].trim().replace(/\s+/g, '_') } : {} }]);

  // RECORD CHECKS
  m = /^(?:run|check|query|look ?up|search)\s+(?:a\s+)?(?:plate|tag|license|registration)\s+(?:number\s+)?(.+)$/.exec(t);
  if (m) return out('lookup_record', '', [{ tool: 'lookup_record', params: { kind: 'plate', query: m[1].toUpperCase().replace(/\s+/g, '') } }, { tool: 'open_ncic', params: { type: 'vehicle', query: m[1].toUpperCase().replace(/\s+/g, '') } }]);
  m = /^(?:run|check|query|look ?up|search)\s+(?:a\s+)?(?:warrants?)\s+(?:on|for)?\s*(.+)$/.exec(t);
  if (m) return out('lookup_record', '', [{ tool: 'lookup_record', params: { kind: 'warrant', query: m[1] } }, { tool: 'open_ncic', params: { type: 'warrant', query: m[1] } }]);
  m = /^(?:run|check|query|look ?up|search)\s+(?:a\s+)?(?:name|person|subject)\s+(?:on|for)?\s*(.+)$/.exec(t);
  if (m) return out('lookup_record', '', [{ tool: 'lookup_record', params: { kind: 'person', query: m[1] } }, { tool: 'open_ncic', params: { type: 'person', query: m[1] } }]);
  m = /^(?:run|check|query|look ?up|search)\s+(?:a\s+)?vin\s+(.+)$/.exec(t);
  if (m) return out('lookup_record', '', [{ tool: 'lookup_record', params: { kind: 'vin', query: m[1].toUpperCase().replace(/\s+/g, '') } }]);
  m = /^(?:premise|premises|history|hazards?|check address|check premise)\s+(?:on|at|for)?\s*(.+)$/.exec(t);
  if (m) return out('lookup_record', '', [{ tool: 'lookup_record', params: { kind: 'premise', query: m[1] } }]);

  // CALL STATUS / SELECT
  m = new RegExp(String.raw`^(?:status|what.?s the status|who.?s) (?:of|on|for|assigned to)?\s*${CALL}$`).exec(t);
  if (m) return out('call_status', '', [{ tool: 'call_status', params: { call: m[1] } }]);
  m = new RegExp(String.raw`^(?:show|open|select|pull up|bring up|go to|ci)\s+${CALL}$`).exec(t);
  if (m) return out('select_call', '', [{ tool: 'select_call', params: { call: m[1] } }]);

  // UNIT LOCATION / LIST
  m = new RegExp(String.raw`^(?:where.?s|where is|locate|find|20 on|10-?20)\s+${UNIT}$`).exec(t);
  if (m) return out('unit_location', '', [{ tool: 'unit_location', params: { unit: m[1].toUpperCase() } }]);
  m = /^(?:who.?s|who is|which unit is)\s+(?:the\s+)?(?:closest|nearest)\s+(?:unit\s+)?(?:to\s+)(.+)$/.exec(t);
  if (m) return out('closest_unit', '', [{ tool: 'closest_unit', params: { address: m[1] } }]);
  if (/^(?:units?|unit status|us|all units|who.?s (?:on|working|available)|available units)$/.test(t)) return out('list_units', '', [{ tool: 'list_units', params: {} }]);
  m = new RegExp(String.raw`^(?:status|us)\s+${UNIT}$`).exec(t);
  if (m) return out('list_units', '', [{ tool: 'list_units', params: { unit: m[1].toUpperCase() } }]);
  if (/^(?:pending|pending calls|what.?s pending|queue|show pending|holding calls|what do i have)$/.test(t)) return out('list_pending', '', [{ tool: 'list_pending', params: {} }]);

  // BOLO
  m = /^(?:bolo|be on the lookout|attempt to locate|atl|put out a bolo)\s+(?:for|on)?\s*(.+)$/.exec(t);
  if (m) {
    const d = m[1].trim();
    const type = /\b(plate|vehicle|car|truck|suv|sedan|van)\b/.test(d) ? 'vehicle' : /\b(male|female|man|woman|person|subject|juvenile)\b/.test(d) ? 'person' : 'other';
    return out('create_bolo', '', [{ tool: 'create_bolo', params: { type, title: d.slice(0, 100), description: d } }]);
  }

  // DELETE (true delete — deliberately narrow wording, and the only tool that
  // still raises the Y/N gate). "remove"/"drop" are NOT accepted here: they are
  // unassign verbs, and a mis-heard "remove 12" must never become a delete.
  m = new RegExp(String.raw`^(?:permanently\s+)?(?:delete|purge)\s+(?:call\s+)?${CALL}$`).exec(t);
  if (m) return out('delete_call', '', [{ tool: 'delete_call', params: { call: m[1] } }]);

  // ARCHIVE / UNARCHIVE
  m = new RegExp(String.raw`^archive\s+${CALL}$`).exec(t);
  if (m) return out('archive_call', '', [{ tool: 'archive_call', params: { call: m[1] } }]);
  m = new RegExp(String.raw`^(?:unarchive|restore)\s+${CALL}$`).exec(t);
  if (m) return out('unarchive_call', '', [{ tool: 'unarchive_call', params: { call: m[1] } }]);

  // MERGE:  "merge 42 into 142", "42 is a duplicate of 142"
  m = new RegExp(String.raw`^merge\s+${CALL}\s+(?:in)?to\s+${CALL}$`).exec(t);
  if (m) return out('merge_calls', '', [{ tool: 'merge_calls', params: { call: m[1], into: m[2] } }]);
  m = new RegExp(String.raw`^${CALL}\s+is\s+a\s+(?:duplicate|dupe)\s+of\s+${CALL}$`).exec(t);
  if (m) return out('merge_calls', '', [{ tool: 'merge_calls', params: { call: m[1], into: m[2] } }]);

  // PROMOTE TO INCIDENT
  m = new RegExp(String.raw`^(?:promote|write|make)\s+(?:a\s+)?(?:report|incident)?\s*(?:on|for|from)?\s*${CALL}(?:\s+to\s+(?:an\s+)?incident)?$`).exec(t);
  if (m && /\b(promote|report|incident)\b/.test(t)) {
    return out('promote_to_incident', '', [{ tool: 'promote_to_incident', params: { call: m[1] } }]);
  }

  // LE NOTIFICATION:  "notify slcpd on 42", "42 notified uhp case 25-1234"
  m = new RegExp(String.raw`^(?:notify|notified|le notify)\s+(.+?)\s+(?:on|for|about)\s+${CALL}$`).exec(t);
  if (m) return out('notify_agency', '', [{ tool: 'notify_agency', params: { call: m[2], agency: m[1].trim().toUpperCase() } }]);

  // REDISPATCH / RETURN VISIT + UNDO
  m = new RegExp(String.raw`^(?:redispatch|re dispatch|return visit|schedule (?:a )?return(?: visit)?)\s+(?:on|for)?\s*${CALL}$`).exec(t);
  if (m) return out('redispatch', '', [{ tool: 'redispatch', params: { call: m[1] } }]);
  m = new RegExp(String.raw`^(?:undo|cancel)\s+(?:the\s+)?(?:redispatch|re dispatch|return visit)\s+(?:on|for)?\s*${CALL}$`).exec(t);
  if (m) return out('undo_redispatch', '', [{ tool: 'undo_redispatch', params: { call: m[1] } }]);

  // MILEAGE:  "12 mileage 45000", "set 12 odometer to 45,000"
  m = new RegExp(String.raw`^(?:set\s+|log\s+|record\s+)?${UNIT}\s+(?:mileage|odometer|miles)\s+(?:is\s+|to\s+|at\s+)?([\d,]+)$`).exec(t);
  if (m) return out('set_unit_mileage', '', [{ tool: 'set_unit_mileage', params: { unit: m[1].toUpperCase(), mileage: Number(m[2].replace(/,/g, '')) } }]);

  // TEN-CODE LOOKUP:  "code 10-71", "what is a 10-71", "10-71"
  m = /^(?:(?:what'?s|what is)\s+(?:a\s+)?)?(?:code[\s-]*)?((?:10-\d{1,3})|(?:code-?\d{1,2}))$/.exec(t);
  if (m) return out('lookup_code', '', [{ tool: 'lookup_code', params: { code: m[1].toUpperCase() } }]);

  // PREMISE ALERTS at an address
  m = /^(?:premise\s+)?alerts?\s+(?:at|on|for)\s+(.+)$/.exec(t);
  if (m) return out('premise_alerts', '', [{ tool: 'premise_alerts', params: { address: m[1].trim() } }]);

  // TIMELINE / SHIFT SUMMARY
  m = new RegExp(String.raw`^(?:timeline|history|audit(?: trail)?)\s+(?:of|on|for)?\s*${CALL}$`).exec(t);
  if (m) return out('call_timeline', '', [{ tool: 'call_timeline', params: { call: m[1] } }]);
  if (/^(?:shift summary|summary|sitrep|how.?s the shift|shift stats?)$/.test(t)) {
    return out('shift_summary', '', [{ tool: 'shift_summary', params: {} }]);
  }

  // NAVIGATE
  m = /^(?:go to|open|show|take me to|navigate to)\s+(?:the\s+)?(map|records|warrants|bolos|communications|field interviews|trespass orders|plate log|radio|fleet|reports|intel|admin|dispatch)(?:\s+page)?$/.exec(t);
  if (m) return out('navigate', '', [{ tool: 'navigate', params: { page: m[1].replace(/\s+/g, '-') } }]);

  return null;
}
