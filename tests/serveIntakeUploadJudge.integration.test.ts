import { describe, it, expect } from 'vitest';

import { judgeMerged } from '../src/utils/serveIntakeJudge';
import { parseDefendants } from '../src/utils/serveIntakeDefendants';

function mkEnv(judgeText: string): any {
  return { DB: {} as any, AI: { run: async () => ({ response: judgeText }) } };
}

describe('serve-intake integration — judge composes with defendant parse', () => {
  it("single-defendant packet: parseDefendants returns 1 → no fan-out, judge runs", async () => {
    const fields = {
      recipient_first_name: { value: 'Alice', confidence: 0.9 },
      recipient_last_name: { value: 'Smith', confidence: 0.9 },
      defendant: { value: 'Alice Smith', confidence: 0.95 },
    };
    const rawDocs = [{ name: 'doc.pdf', text: 'Defendant: Alice Smith' }];
    const judge = await judgeMerged(mkEnv('{}'), fields, rawDocs, ['info_page']);
    expect(judge.overall_status).toBe('clean');
    expect(parseDefendants(fields.defendant.value)).toHaveLength(1);
  });

  it("multi-defendant ';'-separated packet: parseDefendants returns N", async () => {
    const fields = { defendant: { value: 'Alice Smith; Bob Doe; Carol Roe', confidence: 0.95 } };
    const rawDocs = [{ name: 'doc.pdf', text: 'Defendant: Alice Smith; Bob Doe; Carol Roe' }];
    const judge = await judgeMerged(mkEnv('{}'), fields, rawDocs, ['court_filing']);
    expect(parseDefendants(fields.defendant.value)).toHaveLength(3);
    expect(judge.overall_status).toBe('clean');
  });

  it("heuristic floor: LLM cannot upgrade a name absent from raw text", async () => {
    const fields = { recipient_first_name: { value: 'Alice', confidence: 0.95 } };
    const rawDocs = [{ name: 'doc.pdf', text: 'Defendant: Bob Smith' }];
    const judge = await judgeMerged(
      mkEnv('{"verdicts":{"recipient_first_name":{"ok":true,"reason":null,"suggested_value":null,"judge_confidence":0.9}}}'),
      fields, rawDocs, ['info_page'],
    );
    expect(judge.verdicts.recipient_first_name.ok).toBe(false);
    expect(judge.verdicts.recipient_first_name.source).toBe('heuristic');
  });
});
