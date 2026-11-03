// TI-2: золотой корпус решений над ходом. Только детерминированные функции:
// ни одного вызова модели, сети или базы. Ходы — синтетика стенда + выдуманные
// кейсы классов находок 0.10.7–0.10.9.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AIMessage } from '../services/AIService';
import { attachedTurn, type AttachedNoteBlock } from '../utils/attachedNoteFormat';
import { turnScope } from '../utils/turnScope';
import { detectRisk } from '../utils/riskDetect';
import { prepareApiMessages } from '../utils/aiChatTransport';
import { referencedDays } from '../services/chatContext/explicitRefs';
import { buildRelatedDaysBlock } from '../services/chatContext/relatedDays';
import { evalAskMode } from '../../../shared/ai/evalAsk';
import { questionOnly } from '../../../shared/ai/languageNudge';
import { buildChatSystemPrompt, isLongNoteTurn } from '../../../shared/ai/buildChatPrompt';
import { localDayKey } from '../../../core/utils/dateUtils';

interface CorpusNote { id: string; title: string; day: string; body?: string }
interface TurnSpec { notes: CorpusNote[]; question: string }
interface GoldenCase {
  id: string;
  source: string;
  notes?: CorpusNote[];
  question?: string;
  turns?: TurnSpec[];
  hidden?: string[];
}
interface ExpectedRecord {
  turnScope: string;
  evalAskMode: boolean;
  evalAskPrompt: boolean;
  referencedDays: string[][];
  risk: { isRisk: boolean; severity: string };
  api: string[];
  /** DL-19 (семья S11): правило длинного текста и потолок ×2 для подробного разбора. */
  longNote: boolean;
}

const FIXTURES = join(import.meta.dirname, '../__fixtures__');
const CORPUS = JSON.parse(readFileSync(join(FIXTURES, 'golden-turns.json'), 'utf8')) as { cases: GoldenCase[] };
const EXPECTED_PATH = join(FIXTURES, 'golden-turns.expected.json');

const dayMs = (day: string) => new Date(`${day}T12:00:00`).getTime();
const block = (n: CorpusNote): AttachedNoteBlock => ({
  documentId: n.id,
  title: n.title,
  lastSessionAt: dayMs(n.day),
  ...(n.body === undefined ? {} : { content: n.body }),
});
const turnsOf = (c: GoldenCase): TurnSpec[] => c.turns ?? [{ notes: c.notes!, question: c.question! }];

function messagesOf(c: GoldenCase): AIMessage[] {
  const turns = turnsOf(c);
  const out: AIMessage[] = [];
  turns.forEach((t, i) => {
    out.push({ role: 'user', type: 'chat', content: attachedTurn(t.notes.map(block), t.question) } as AIMessage);
    if (i < turns.length - 1) out.push({ role: 'assistant', type: 'chat', content: `Ответ модели ${i + 1}.` } as AIMessage);
  });
  return out;
}

function decide(c: GoldenCase): ExpectedRecord {
  const turns = turnsOf(c);
  const last = turns[turns.length - 1]!;
  const display = attachedTurn(last.notes.map(block), last.question);
  const risk = detectRisk(display);
  return {
    turnScope: turnScope(last.question),
    evalAskMode: evalAskMode(questionOnly(display)),
    evalAskPrompt: buildChatSystemPrompt({ personaId: 'editor', lastUserMessage: display }).includes('FEEDBACK MODE'),
    referencedDays: last.notes.map(n => [...referencedDays(n.body ?? '', dayMs(n.day))].sort((a, b) => a - b).map(d => localDayKey(d))),
    risk: { isRisk: risk.isRisk, severity: risk.severity },
    api: prepareApiMessages(messagesOf(c), { hiddenCitationIds: new Set(c.hidden ?? []) }).map(m => m.content),
    longNote: isLongNoteTurn({ personaId: 'group_psychology', responseLength: 'detailed', documentContent: attachedTurn(last.notes.map(block)) }),
  };
}

const records: Record<string, ExpectedRecord> = Object.fromEntries(CORPUS.cases.map(c => [c.id, decide(c)]));
const UPDATE = process.env.UPDATE_GOLDEN === '1';
// Ревью 0.10.10: без файла ожиданий тест сравнивал вывод сам с собой — не мог
// покраснеть. Нет файла — каждый случай красный (ожидание undefined).
const expected: { records: Record<string, ExpectedRecord | undefined> } = UPDATE
  ? { records }
  : existsSync(EXPECTED_PATH) ? JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as { records: Record<string, ExpectedRecord> } : { records: {} };
if (UPDATE) writeFileSync(EXPECTED_PATH, JSON.stringify({ _meta: { generated: 'UPDATE_GOLDEN=1', cases: CORPUS.cases.length }, records }, null, 2));

describe('TI-2: золотой корпус решений над ходом', () => {
  it('корпус в заявленном размере: 40–60 ходов', () => {
    expect(CORPUS.cases.length).toBeGreaterThanOrEqual(40);
    expect(CORPUS.cases.length).toBeLessThanOrEqual(60);
  });

  for (const c of CORPUS.cases) {
    it(c.id, () => {
      expect(records[c.id]).toEqual(expected.records[c.id]);
    });
  }
});

describe('TI-2: Н-3 — «вчера» второй заметки от её дня', () => {
  it('фон берёт канун второй заметки, а не первой', () => {
    const blocks = [
      { documentId: 'local_n3_a', title: 'раз', lastSessionAt: dayMs('2026-10-15'), content: 'сегодня тихо' },
      { documentId: 'local_n3_b', title: 'два', lastSessionAt: dayMs('2026-10-05'), content: 'вчера чинил ворота' },
    ];
    const doc = (id: string, day: string) => ({ id, lastSessionAt: dayMs(day), firstSessionAt: dayMs(day) }) as never;
    const docs = new Map([
      ['local_n3_a', doc('local_n3_a', '2026-10-15')],
      ['local_n3_b', doc('local_n3_b', '2026-10-05')],
      ['before_att', doc('before_att', '2026-10-14')],
      ['before_two', doc('before_two', '2026-10-04')],
    ]);
    const sums = new Map([
      ['before_att', { summary: 'канун первой' } as never],
      ['before_two', { summary: 'канун второй' } as never],
    ]);
    const r = buildRelatedDaysBlock('local_n3_a', [], docs, sums, blocks, ['local_n3_b']);
    expect(r?.ids).toEqual(['before_two']);
  });
});
