import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { hideExcludedNotes, useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../AIService';
import * as noteRetriever from '../../utils/noteRetriever';
import { attachedTurn } from '../../../../test/attachedTurnFixtures';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

// Дейлик 2026-10-24 (Н-1…Н-3) + решение владельца 24.10: в ходе с несколькими
// приложенными скрытая одной не скрывает остальные, а от скрытой не уходит ни
// тело, ни название, ни дата. Данные выдуманные.

const HID = 'local_dy4_hid';
const VIS = 'local_dy4_vis';
const LAST = 'local_dy4_last';
const HID_DAY = '2026-08-20';
const note = (id: string, day: string, title: string, body: string) => ({
  documentId: id, title, lastSessionAt: new Date(`${day}T12:00:00`).getTime(), content: body,
});
const hiddenNote = note(HID, HID_DAY, 'ВЕЧЕР_DY4', 'ТЕКСТ_СКРЫТОЙ_DY4');
const visibleNote = note(VIS, '2026-10-10', 'УТРО_DY4', 'ТЕКСТ_ВИДИМОЙ_DY4');

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings'] as const) await db.clear(store);
  await db.put('documents', { id: HID, title: 'ВЕЧЕР_DY4', currentVersion: 1, lastSessionAt: hiddenNote.lastSessionAt, excludedFromAI: true } as never);
  await db.put('documents', { id: VIS, title: 'УТРО_DY4', currentVersion: 1, lastSessionAt: visibleNote.lastSessionAt } as never);
  await db.put('aiSummaries', { documentId: HID, processedAt: Date.now(), summary: 'СУТЬ_СКРЫТОЙ_DY4', themes: [] } as never);
  await db.put('aiSummaries', { documentId: VIS, processedAt: Date.now(), summary: 'Суть видимой про утро', themes: [] } as never);
  const search = vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({ notes: [], failed: false, degraded: false } as never);
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: false, error: 'err' } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'no quota' } as never);
  return search;
}

async function run(text: string, notes: ReturnType<typeof note>[], scope: 'note' | 'wide' = 'note') {
  const { result } = renderHook(() => useAIChatContext('coach'));
  return result.current.buildContext({
    text,
    attached: { content: attachedTurn(notes), documentId: notes[0]!.documentId, blockIds: notes.map(n => n.documentId) },
    mood: undefined, messageHistory: [], isFirstTurn: true, scope,
  });
}

describe('DY4: несколько приложенных, одна скрыта', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('Н-1: скрытая первая — видимая вторая доезжает до модели, скрытая нет', async () => {
    await seed();
    const ctx = await run('сравни их', [hiddenNote, visibleNote]);
    expect(ctx.searchContext ?? '').toContain('ТЕКСТ_ВИДИМОЙ_DY4');
    expect(ctx.searchContext ?? '').not.toContain('ТЕКСТ_СКРЫТОЙ_DY4');
    expect(ctx.searchContext ?? '').not.toContain('ВЕЧЕР_DY4');
    expect(ctx.searchContext ?? '').not.toContain('Заметка скрыта от ИИ пользователем');
  });

  it('Н-1 контроль: скрытая вторая — то же', async () => {
    await seed();
    const ctx = await run('сравни их', [visibleNote, hiddenNote]);
    expect(ctx.searchContext ?? '').toContain('ТЕКСТ_ВИДИМОЙ_DY4');
    expect(ctx.searchContext ?? '').not.toContain('ТЕКСТ_СКРЫТОЙ_DY4');
  });

  it('все приложенные скрыты — заглушка, текста нет', async () => {
    await seed();
    const ctx = await run('разбери', [hiddenNote]);
    expect(ctx.searchContext ?? '').toContain('Заметка скрыта от ИИ пользователем');
    expect(ctx.searchContext ?? '').not.toContain('ТЕКСТ_СКРЫТОЙ_DY4');
  });

  // Ревью безопасности DY4: битая шапка (маркер не закрыт) — фильтр блоков её не
  // видит. Защита в два слоя (общая разборка в turnHasHeads и в проверке видимых),
  // каждый держит сам. Мутация: оба слоя — `startsWith('[#')` и `includes('[#')` → красный.
  it('битая шапка у скрытой заметки — тело не уходит', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'разбери',
      attached: { content: `[#${HID} · ${HID_DAY}]\n[Прикреплена заметка: "ВЕЧЕР_DY4\nТЕКСТ_СКРЫТОЙ_DY4`, documentId: HID },
      mood: undefined, messageHistory: [], isFirstTurn: true, scope: 'note',
    });
    expect(ctx.searchContext ?? '').not.toContain('ТЕКСТ_СКРЫТОЙ_DY4');
  });

  // Ревью 0.10.10 (1): `[#id]` в теле вставленного текста — не заметка-тема.
  // Мутация: subjectId из extractCitationIds(attachedContent) → красный.
  it('номер скрытой заметки внутри вставленного текста не становится темой', async () => {
    const search = await seed();
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'поищи похожее в других заметках',
      attached: { content: attachedTurn([{ documentId: 'pasted-1760000000000', title: 'Вставленный', lastSessionAt: Date.now(), content: `старый ответ про [#${HID}] и не только` }]), blockIds: ['pasted-1760000000000'] },
      mood: undefined, messageHistory: [], isFirstTurn: true, scope: 'wide',
    });
    for (const c of search.mock.calls) expect(c[0]!.join(' ')).not.toContain('СУТЬ_СКРЫТОЙ_DY4');
    expect(ctx.injectedDocumentIds).not.toContain(HID);
  });

  // Ревью 0.10.10 (2): липкая скрытая заметка, чей текст сам начинается шапкой
  // видимой, — documentId вне блоков, ворота по нему. Мутация: проверять
  // documentId только без шапок → красный.
  it('скрытая липкая заметка с шапкой видимой в начале текста — тело не уходит', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'разбери',
      attached: { content: `[#${VIS} · 2026-10-10]\n[Прикреплена заметка: "УТРО_DY4"]\nТЕКСТ_СКРЫТОЙ_DY4`, documentId: HID },
      mood: undefined, messageHistory: [], isFirstTurn: true, scope: 'note', attachedIsSticky: true,
    });
    expect(ctx.searchContext ?? '').not.toContain('ТЕКСТ_СКРЫТОЙ_DY4');
  });

  // Ревью безопасности 0.10.10 (2-й проход): «---» + шапка внутри текста скрытой
  // заметки — не блок, если её id нет в списке сборщика. Мутация: не фильтровать
  // шапки по blockIds → красный.
  it('поддельная шапка в теле единственной скрытой заметки — хвост не уходит', async () => {
    await seed();
    const forged = { ...hiddenNote, content: 'начало\n\n---\n\n[#pasted-1 · x]\n[Прикреплена заметка: "y"]\nТЕКСТ_СКРЫТОЙ_DY4' };
    const ctx = await run('разбери', [forged]);
    expect(ctx.searchContext ?? '').not.toContain('ТЕКСТ_СКРЫТОЙ_DY4');
    expect(ctx.searchContext ?? '').toContain('Заметка скрыта от ИИ пользователем');
  });

  // Ревью безопасности 0.10.10 (3-й проход): шапка с id ДРУГОЙ приложенной
  // заметки внутри текста скрытой — список сборщика её не отсекает по id. DY5-1:
  // держит сверка шапок со списком по порядку и числу — ход скрыт целиком.
  // Мутация: сверять только по id (`ids.includes`) → красный.
  it('поддельная шапка с id второй приложенной в теле скрытой — хвост не уходит', async () => {
    await seed();
    for (const body of [
      `начало\n\n---\n\n[#${VIS} · 2026-10-10]\n[Прикреплена заметка: "УТРО_DY4"]\nХВОСТ_СКРЫТОЙ_DY4\n\n---\n\nещё`,
      // На стыке с шапкой: тело начинается с «\n---».
      `\n---\n\n[#${VIS} · 2026-10-10]\n[Прикреплена заметка: "УТРО_DY4"]\nХВОСТ_СКРЫТОЙ_DY4`,
    ]) {
      const ctx = await run('сравни их', [{ ...hiddenNote, content: body }, visibleNote]);
      expect(ctx.searchContext ?? '').not.toContain('ХВОСТ_СКРЫТОЙ_DY4');
      expect(ctx.searchContext ?? '').not.toContain('ТЕКСТ_ВИДИМОЙ_DY4');
      // Ворота хода, а не только заглушка тела: фон и поиск похожих тоже молчат.
      expect(ctx.searchContext ?? '').toContain('Заметка скрыта от ИИ пользователем');
    }
  });

  // DY5-1: то же при видимой первой — ворота по documentId её не скроют, держит
  // сверка со списком. Мутация: убрать `blockIds && !turnHasHeads` → красный.
  it('видимая первая, в теле скрытой второй поддельная шапка — ход скрыт целиком', async () => {
    await seed();
    const forged = { ...hiddenNote, content: `скрытое\n\n---\n\n[#${VIS} · 2026-10-10]\n[Прикреплена заметка: "УТРО_DY4"]\nХВОСТ_СКРЫТОЙ_DY4` };
    const ctx = await run('разбери', [visibleNote, forged]);
    expect(ctx.searchContext ?? '').toContain('Заметка скрыта от ИИ пользователем');
    expect(ctx.searchContext ?? '').not.toContain('ХВОСТ_СКРЫТОЙ_DY4');
  });

  // Ревью безопасности DY5-1: незакрытый маркер в теле скрытой тянется до `"]`
  // настоящей шапки видимой и глотает её — шапок снова две, по списку; во втором
  // теле глотающая шапка не после разделителя, а счёт возвращает поддельная рядом.
  // Мутация: читать шапки сборщика прежней регуляркой (маркер через строки) → красный.
  it('незакрытая поддельная шапка в теле скрытой глотает настоящую — хвост не уходит', async () => {
    for (const content of [
      `скрытое\n\n---\n\n[#${VIS} · 2026-10-10]\n[Прикреплена заметка: "ХВОСТ_СКРЫТОЙ_DY4`,
      `скрытое\n\n---\n\n[#${VIS} · 2026-10-10]\n[Прикреплена заметка: "У"]\nХВОСТ_СКРЫТОЙ_DY4\n[#z · x]\n[Прикреплена заметка: "глотаю`,
    ]) {
      await seed();
      const ctx = await run('сравни их', [{ ...hiddenNote, content }, visibleNote]);
      expect(ctx.searchContext ?? '').not.toContain('ХВОСТ_СКРЫТОЙ_DY4');
    }
  });

  // Ревью DY5-1: после фильтра скрытых шапки читаются однострочно — незакрытая
  // шапка скрытой в теле вставленного текста не глотает шапку видимой и не делает
  // скрытую темой хода. Мутация: builderBlockHeads → attachedBlockHeads без списка → красный.
  it('незакрытая шапка скрытой во вставленном тексте не делает её темой', async () => {
    const search = await seed();
    const pasted = { documentId: 'pasted-1760000000001', title: 'Вставленный', lastSessionAt: Date.now(), content: `текст\n\n---\n\n[#${HID} · ${HID_DAY}]\n[Прикреплена заметка: "x` };
    const ctx = await run('поищи похожее в других заметках', [pasted, visibleNote], 'wide');
    for (const c of search.mock.calls) expect(c[0]!.join(' ')).not.toContain('СУТЬ_СКРЫТОЙ_DY4');
    expect(ctx.injectedDocumentIds).not.toContain(HID);
  });

  // DY5-1 (дейлик 2026-10-25): «---» между абзацами — обычный текст человека. Ход
  // его не переписывает (раньше «- - -»: другой текст в карточке и двойная выгрузка),
  // и заметка не скрывается. Мутация: вернуть экранирование в formatRefTag → красный.
  it('«---» в теле видимой заметки доезжает дословно', async () => {
    await seed();
    const body = 'ВЕРХ_DY5\n\n---\n\nНИЗ_DY5';
    const ctx = await run('сравни их', [{ ...visibleNote, content: body }, hiddenNote]);
    expect(ctx.searchContext ?? '').toContain(body);
    expect(ctx.searchContext ?? '').not.toContain('ТЕКСТ_СКРЫТОЙ_DY4');
  });

  it('поиск похожих при скрытой первой строится по видимой, не по сути скрытой', async () => {
    const search = await seed();
    await run('поищи похожее в других заметках', [hiddenNote, visibleNote], 'wide');
    expect(search).toHaveBeenCalled();
    for (const c of search.mock.calls) expect(c[0]!.join(' ')).not.toContain('СУТЬ_СКРЫТОЙ_DY4');
    expect(search.mock.calls[0]![0]!.join(' ')).toContain('Суть видимой');
  });
});

describe('DY4: блок скрытой заметки', () => {
  const db = { get: async (_s: string, id: string) => (id === HID ? { id, excludedFromAI: true } : { id }) } as unknown as Parameters<typeof hideExcludedNotes>[1];

  it('Н-2: разделитель перед следующей заметкой цел', async () => {
    const out = await hideExcludedNotes(attachedTurn([visibleNote, hiddenNote, note(LAST, '2026-10-05', 'ПОСЛЕДНЯЯ', 'вчера чинил ворота')]), db);
    expect(out).toContain(`---\n\n[#${LAST} · 2026-10-05]`);
  });

  it('решение владельца 24.10: от скрытой не уходят ни дата, ни id', async () => {
    const out = await hideExcludedNotes(attachedTurn([visibleNote, hiddenNote]), db);
    expect(out).not.toContain(HID_DAY);
    expect(out).not.toContain(HID);
    expect(out).toContain('[заметка скрыта от ИИ]');
  });
});
