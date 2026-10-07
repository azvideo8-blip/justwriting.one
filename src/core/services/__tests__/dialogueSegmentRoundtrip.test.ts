import { describe, it, expect } from 'vitest';
import { planDialogue, headRowPayload, segmentRowPayload, readSegmentVersion } from '../dialogueSegments';
import { dialogueFingerprint, mergeDialogues } from '../../storage/dialogueMerge';
import type { AIDialogue } from '../../storage/localDb';

// Прод, 2026-10-07: head длинного старого диалога переписывался в облаке каждые
// 2 минуты, а журнал говорил «получено с других устройств: 1» на каждом проходе.
// Забор сливал облачную копию с локальной, отпечатки не совпадали, и диалог
// ставился на выгрузку снова: head не нёс поле lastExtractedIdx.

/** Все поля диалога. Required<> заставляет дописать сюда каждое новое поле типа. */
const FULL: Required<AIDialogue> = {
  id: 'dlg-legacy',
  title: 'Старый длинный диалог',
  personaId: 'coach',
  personaName: 'Коуч',
  personaEmoji: '🚀',
  documentId: 'local_doc',
  messages: Array.from({ length: 60 }, (_, i) => ({
    id: `m${i}`, role: i % 2 ? 'assistant' as const : 'user' as const,
    content: `реплика ${i} `.repeat(400), createdAt: 1_000 + i, updatedAt: 1_000 + i,
  })),
  createdAt: 1_000,
  updatedAt: 5_000,
  archivedAt: 4_000,
  responseLength: 'standard',
  reasoning: false,
  closingSummary: 'итог',
  lastExtractedIdx: 40,
  lastExtractedMessageId: 'm39',
  deletedMessages: [{ id: 'gone', at: Date.now() }],
  schema: 2,
  deletedAt: undefined as unknown as number,
};

function throughCloud(d: AIDialogue, serverStamp: number): AIDialogue {
  const plan = planDialogue(d, {}, 20_000);
  const rows = [
    { key: d.id, payload: { ...headRowPayload(plan.head), updatedAt: serverStamp } },
    ...plan.segments.map(s => ({ key: s.key, payload: segmentRowPayload(s) })),
  ];
  const version = readSegmentVersion(rows as never);
  if (!version || version.kind !== 'segments') throw new Error('облачная копия не читается');
  return { ...version.dialogue, updatedAt: serverStamp };
}

describe('head + сегменты: диалог переживает облако без потерь', () => {
  it('каждое поле диалога возвращается тем же', () => {
    const { deletedAt: _d, ...live } = FULL;
    const back = throughCloud(live, live.updatedAt);
    expect(dialogueFingerprint(back)).toBe(dialogueFingerprint(live));
  });

  it('старый диалог с позиционным курсором: после забора выгружать нечего', () => {
    const { deletedAt: _d, lastExtractedMessageId: _m, ...legacy } = FULL;
    const cloud = throughCloud(legacy, 9_000); // сервер поставил свою отметку
    const merged = mergeDialogues(legacy, cloud);
    // AIRestoreService: отпечатки разные → scheduleStoreSync → петля.
    expect(dialogueFingerprint(merged)).toBe(dialogueFingerprint(cloud));
  });
});
