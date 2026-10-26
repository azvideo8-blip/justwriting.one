import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { prepareApiMessages } from '../../utils/aiChatTransport';
import { AIChatMemoryService } from '../AIChatMemoryService';
import { AIService } from '../AIService';
import { buildProactiveBlock } from '../chatContext/proactive';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

// AP-2: старый ответ ассистента цитирует заметку, которую потом скрыли. Фильтр
// приложенной заметки его не видел: ответ уходил и в API, и в извлечение
// памяти, и в проактивный блок архивного диалога. Маркеры выдуманные.

const DOC_HIDDEN = 'doc_hidden_ap2';
const DOC_OK = 'doc_ok_ap2';
const MARKER = 'МАРКЕР-ЦИТАТЫ-AP2';
const VISIBLE_MARKER = 'МАРКЕР-ВИДИМОЙ-AP2';

const doc = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  uuid: `uuid_${id}`,
  guestId: 'guest',
  title: id,
  currentVersion: 1,
  totalWords: 10,
  totalDuration: 100,
  sessionsCount: 1,
  firstSessionAt: Date.UTC(2026, 8, 10),
  lastSessionAt: Date.UTC(2026, 8, 10),
  tags: [],
  ...extra,
});

const hiddenAnswer = `В записи [#${DOC_HIDDEN}] ты писал: «${MARKER}»`;
const visibleAnswer = `В записи [#${DOC_OK}] ты писал: «${VISIBLE_MARKER}»`;

describe('AP-2: цитаты скрытой заметки не идут из истории, памяти и сводок', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.restoreAllMocks();
    const db = await getLocalDb();
    for (const store of [
      'documents', 'aiDialogues', 'aiDialogueEvents', 'aiChatMemory', 'aiTimeline',
      'aiMonthlyDigest', 'aiCommitments', 'aiThreads', 'aiSummaries', 'aiProfileFacets',
    ] as const) {
      await db.clear(store);
    }
    await db.put('documents', doc(DOC_OK));
    await db.put('documents', doc(DOC_HIDDEN, { excludedFromAI: true }));
  });

  it('prepareApiMessages заменяет ответ с цитатой скрытой заметки заглушкой', () => {
    const messages = [
      { role: 'user' as const, content: 'что я писал?', type: 'chat' as const },
      { role: 'assistant' as const, content: hiddenAnswer, type: 'chat' as const },
      { role: 'assistant' as const, content: visibleAnswer, type: 'chat' as const },
    ];

    const out = prepareApiMessages(messages, { hiddenCitationIds: new Set([DOC_HIDDEN, 'uuid_' + DOC_HIDDEN]) });

    expect(out[1]?.content).toBe('[ответ о скрытой заметке]');
    expect(JSON.stringify(out)).not.toContain(MARKER);
    expect(out[2]?.content).toContain(VISIBLE_MARKER);
  });

  it('окно извлечения памяти не получает цитату скрытой заметки, а новая память знает источники', async () => {
    const db = await getLocalDb();
    const extract = vi.spyOn(AIService, 'extractChatMemory')
      .mockResolvedValue({ ok: true, memories: [{ kind: 'fact', text: 'память ap2' }] } as never);
    const messages = [
      { role: 'user', content: 'расскажи, что я писал про работу в сентябре', id: 'm1' },
      { role: 'assistant', content: visibleAnswer, id: 'm2' },
      { role: 'user', content: 'а что было в той записи про отдых', id: 'm3' },
      { role: 'assistant', content: hiddenAnswer, id: 'm4' },
    ];

    await AIChatMemoryService.extractFromDialogue('d_ap2', messages);

    const sent = JSON.stringify(extract.mock.calls[0]?.[0] ?? {});
    // RA1-13 (осознанно изменено): в окно извлечения больше не входят ответы
    // ассистента, поэтому цитаты скрытой заметки там нет по построению, а
    // видимая цитата из ответа ИИ тоже не приезжает. Источники новой памяти
    // берутся из реплик человека — цитат в них нет, список пуст («источник
    // известен: их нет»), а не старый «неизвестно».
    expect(sent).not.toContain(MARKER);
    expect(sent).not.toContain(VISIBLE_MARKER);
    const memory = (await db.getAll('aiChatMemory'))[0];
    expect(memory?.sourceDocumentIds).toEqual([]);
  });

  it('getRelevant не отдаёт память, извлечённую из цитаты скрытой или удалённой заметки', async () => {
    const db = await getLocalDb();
    const base = { kind: 'fact' as const, createdAt: 1, updatedAt: 1, vector: [1, 0] };
    await db.put('aiChatMemory', { ...base, id: 'mem_hidden', text: 'скрытое', sourceDialogueId: 'd1', sourceDocumentIds: [DOC_HIDDEN] });
    await db.put('aiChatMemory', { ...base, id: 'mem_ok', text: 'видимое', sourceDialogueId: 'd2', sourceDocumentIds: [DOC_OK] });
    await db.put('aiChatMemory', { ...base, id: 'mem_gone', text: 'удалённое', sourceDialogueId: 'd3', sourceDocumentIds: ['doc_gone_ap2'] });
    await db.put('aiChatMemory', { ...base, id: 'mem_legacy', text: 'старая память', sourceDialogueId: 'd4' });
    await db.put('aiChatMemory', { ...base, id: 'mem_nocite', text: 'без цитат', sourceDialogueId: 'd5', sourceDocumentIds: [] });

    const ids = (await AIChatMemoryService.getRelevant([1, 0], 10)).map(m => m.id);

    expect(ids).toContain('mem_ok');
    expect(ids, 'новая память без цитат — источник известен').toContain('mem_nocite');
    // Решение владельца 2026-10-20 (AP-2, «в»): старая память без источника ИИ не
    // получает, пока человек её не просмотрит. Мутация: legacy → true — красный.
    expect(ids).not.toContain('mem_legacy');
    await AIChatMemoryService.markReviewed('mem_legacy');
    expect((await AIChatMemoryService.getRelevant([1, 0], 10)).map(m => m.id), '«вернуть в контекст»').toContain('mem_legacy');
    expect(ids).not.toContain('mem_hidden');
    expect(ids).not.toContain('mem_gone');
  });

  it('проактивный блок не пересказывает архивный диалог, цитировавший скрытую заметку', async () => {
    const db = await getLocalDb();
    const archivedAt = Date.UTC(2026, 8, 20);
    await db.put('aiDialogues', {
      id: 'dlg_hidden_ap2', title: 'о скрытой', personaId: 'coach', personaName: 'Коуч', personaEmoji: 'x',
      messages: [{ role: 'user', content: 'вопрос' }, { role: 'assistant', content: hiddenAnswer }],
      createdAt: 1, updatedAt: 2, archivedAt, closingSummary: `ИТОГ-${MARKER}`,
    });
    await db.put('aiDialogues', {
      id: 'dlg_ok_ap2', title: 'о видимой', personaId: 'coach', personaName: 'Коуч', personaEmoji: 'x',
      messages: [{ role: 'user', content: 'вопрос' }, { role: 'assistant', content: visibleAnswer }],
      createdAt: 1, updatedAt: 3, archivedAt, closingSummary: `ИТОГ-${VISIBLE_MARKER}`,
    });
    await db.put('aiDialogueEvents', {
      dialogueId: 'dlg_hidden_ap2', date: '2026-09-20', month: '2026-09', personaId: 'coach',
      personaName: 'Коуч', summary: `СОБЫТИЕ-${MARKER}`,
    });
    await db.put('aiDialogueEvents', {
      dialogueId: 'dlg_ok_ap2', date: '2026-09-21', month: '2026-09', personaId: 'coach',
      personaName: 'Коуч', summary: `СОБЫТИЕ-${VISIBLE_MARKER}`,
    });

    const block = await buildProactiveBlock({ personaId: 'coach', turnEmb: undefined });

    expect(block).not.toContain(MARKER);
    expect(block).toContain(VISIBLE_MARKER);
  });
});
