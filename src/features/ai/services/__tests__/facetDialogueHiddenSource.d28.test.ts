import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, type AIDialogue, type AIProfileFacet } from '../../../../core/storage/localDb';
import { AIProfileFacetService } from '../AIProfileFacetService';
import { AIProfileService } from '../AIProfileService';
import { AIService } from '../AIService';
import { writeFacetStore } from '../../../../core/services/facetLock';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

// DY6-2 (дейлик 2026-10-26, Н-2): страж грани решает видимость только по noteIds,
// а `dialogueIds` при включённом ff_dialogues_in_facets не проверяет никто —
// пересказ диалога, в котором цитировалась скрытая заметка, лежит в `summary`
// грани и уходит в контекст каждого хода. Маркеры выдуманные.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

const DOC_V1 = 'doc_d28_visible1';
const DOC_V2 = 'doc_d28_visible2';
const DOC_HIDDEN = 'doc_d28_hidden';

const DLG_HIDDEN = 'dlg_d28_about_hidden';
const DLG_CLEAN = 'dlg_d28_clean';
const DLG_TOPIC_HIDDEN = 'dlg_d28_topic_hidden';
const DLG_MISSING = 'dlg_d28_missing';

const doc = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  uuid: `uuid_${id}`,
  guestId: 'guest',
  title: id,
  currentVersion: 1,
  totalWords: 10,
  totalDuration: 100,
  sessionsCount: 1,
  firstSessionAt: Date.UTC(2026, 9, 1),
  lastSessionAt: Date.UTC(2026, 9, 1),
  tags: [],
  ...extra,
});

const dialogue = (id: string, content: string, extra: Partial<AIDialogue> = {}): AIDialogue => ({
  id,
  title: id,
  personaId: 'cbt',
  personaName: 'Аналитик',
  personaEmoji: '🙂',
  messages: [
    { role: 'user', content: 'Что ты видишь?' },
    { role: 'assistant', content },
  ],
  createdAt: Date.UTC(2026, 9, 1),
  updatedAt: Date.UTC(2026, 9, 1),
  ...extra,
});

const facet = (id: string, noteIds: string[], summary: string, dialogueIds?: string[]): AIProfileFacet => ({
  id,
  label: id,
  summary,
  centroid: [1, 0],
  noteIds,
  noteCount: noteIds.length,
  firstAt: 1,
  lastAt: 2,
  updatedAt: 1,
  buildId: 'b_d28',
  ...(dialogueIds ? { dialogueIds } : {}),
});

const CITATION_HIDDEN = `Про [#${DOC_HIDDEN} · 2026-10-01] ты писал: «СКРЫТАЯ_ДЕТАЛЬ_D28»`;
const CITATION_CLEAN = `Про [#${DOC_V1} · 2026-10-02] ты писал: «ВИДИМАЯ_ДЕТАЛЬ_D28»`;

async function seed(): Promise<void> {
  const db = await getLocalDb();
  await db.put('documents', doc(DOC_V1));
  await markAllAnalysed(db);
  await db.put('documents', doc(DOC_V2));
  await markAllAnalysed(db);
  await db.put('documents', doc(DOC_HIDDEN, { excludedFromAI: true }));
  await markAllAnalysed(db);

  await db.put('aiDialogues', dialogue(DLG_HIDDEN, CITATION_HIDDEN));
  await db.put('aiDialogues', dialogue(DLG_CLEAN, CITATION_CLEAN));
  await db.put('aiDialogues', dialogue(DLG_TOPIC_HIDDEN, 'Здесь ссылки нет, но тема диалога — скрытая заметка.', { documentId: DOC_HIDDEN }));
  // DLG_MISSING в хранилище не лежит — на этом устройстве его нет.

  await writeFacetStore(async store => {
    await store.put(facet('facet_d28_hidden_source', [DOC_V1, DOC_V2], 'вывод: … «СКРЫТАЯ_ДЕТАЛЬ_D28»', [DLG_HIDDEN]));
    await store.put(facet('facet_d28_clean', [DOC_V1, DOC_V2], 'вывод: … «ВИДИМАЯ_ДЕТАЛЬ_D28»', [DLG_CLEAN]));
    await store.put(facet('facet_d28_no_dialogues', [DOC_V1, DOC_V2], 'вывод только по заметкам'));
    await store.put(facet('facet_d28_mixed_dialogues', [DOC_V1, DOC_V2], 'один диалог чистый, второй — нет', [DLG_CLEAN, DLG_HIDDEN]));
    await store.put(facet('facet_d28_missing_dialogue', [DOC_V1, DOC_V2], 'диалога нет на устройстве', [DLG_MISSING]));
    await store.put(facet('facet_d28_topic_hidden', [DOC_V1, DOC_V2], 'диалог о скрытой заметке', [DLG_TOPIC_HIDDEN]));
  });
}

describe('DY6-2: страж граней проверяет dialogueIds, а не только noteIds', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.restoreAllMocks();
    const db = await getLocalDb();
    for (const store of ['documents', 'aiDialogues', 'aiDialogueEvents', 'aiProfileFacets'] as const) {
      await db.clear(store);
    }
  });

  it('контроль фикстуры: шесть граней и три диалога лежат в хранилищах', async () => {
    await seed();
    const db = await getLocalDb();
    expect((await db.getAll('aiProfileFacets')).length).toBe(6);
    expect((await db.getAll('aiDialogues')).length).toBe(3);
  });

  it('грань с диалогом-источником, который цитирует скрытую заметку, не отдаётся', async () => {
    await seed();
    const ids = (await AIProfileFacetService.getAll()).map(f => f.id);
    expect(ids, 'страж не посмотрел dialogueIds').not.toContain('facet_d28_hidden_source');
  });

  it('контроль: диалог цитирует только видимые заметки — грань видна', async () => {
    await seed();
    const facets = await AIProfileFacetService.getAll();
    expect(facets.map(f => f.id)).toContain('facet_d28_clean');
    expect(facets.find(f => f.id === 'facet_d28_clean')?.summary).toContain('ВИДИМАЯ_ДЕТАЛЬ_D28');
  });

  it('контроль: грань без dialogueIds проверяется как раньше, только по noteIds', async () => {
    await seed();
    expect((await AIProfileFacetService.getAll()).map(f => f.id)).toContain('facet_d28_no_dialogues');
  });

  it('хотя бы один диалог цитирует скрытую — грань не отдаётся (не «some», а «every»)', async () => {
    await seed();
    const ids = (await AIProfileFacetService.getAll()).map(f => f.id);
    expect(ids).not.toContain('facet_d28_mixed_dialogues');
  });

  it('диалога нет на устройстве — грань с ним не отдаётся', async () => {
    await seed();
    const ids = (await AIProfileFacetService.getAll()).map(f => f.id);
    expect(ids).not.toContain('facet_d28_missing_dialogue');
  });

  it('тема диалога — скрытая заметка: пересказ без ссылки тоже не отдаётся', async () => {
    await seed();
    const ids = (await AIProfileFacetService.getAll()).map(f => f.id);
    expect(ids).not.toContain('facet_d28_topic_hidden');
  });

  it('сбой чтения диалогов: грань с dialogueIds не видна, грань без них — как была', async () => {
    await seed();
    const db = await getLocalDb();
    const origGetAll = db.getAll.bind(db);
    vi.spyOn(db, 'getAll').mockImplementation((storeName: string, ...args: unknown[]) => {
      if (storeName === 'aiDialogues') return Promise.reject(new Error('IDB aiDialogues read error'));
      return origGetAll(storeName as never, ...(args as [never]));
    });

    const ids = (await AIProfileFacetService.getAll()).map(f => f.id);
    expect(ids).not.toContain('facet_d28_hidden_source');
    expect(ids).not.toContain('facet_d28_clean');
    expect(ids).toContain('facet_d28_no_dialogues');
  });

  // Самопроверка 26.10 (независимый читатель, пункт 4): тема или цитата
  // вставленного текста — не заметка (`useAttachmentManager.ts:71` рождает id
  // вида `pasted-<ts>`, строки в `documents` у него нет и не будет). Без
  // исключения S-63 страж прятал бы грань навсегда.
  it('тема диалога — вставленный текст, а не заметка: грань остаётся видимой', async () => {
    const db = await getLocalDb();
    await seed();
    await db.put('aiDialogues', dialogue('dlg_d28_pasted_topic', 'Тема — вставленный текст, ссылки в реплике нет.', { documentId: 'pasted-1730000000000' }));
    await writeFacetStore(async store => {
      await store.put(facet('facet_d28_pasted_topic', [DOC_V1, DOC_V2], 'вывод по вставленному тексту', ['dlg_d28_pasted_topic']));
    });

    expect((await AIProfileFacetService.getAll()).map(f => f.id)).toContain('facet_d28_pasted_topic');
  });

  it('реплика ссылается на вставленный текст [#pasted-*] — грань остаётся видимой', async () => {
    const db = await getLocalDb();
    await seed();
    await db.put('aiDialogues', dialogue('dlg_d28_pasted_cite', `Про [#pasted-1730000000001 · 2026-10-05] ты писал: «ВИДИМОЕ_ВСТАВЛЕННОЕ_D28»`));
    await writeFacetStore(async store => {
      await store.put(facet('facet_d28_pasted_cite', [DOC_V1, DOC_V2], 'вывод по вставленному', ['dlg_d28_pasted_cite']));
    });

    expect((await AIProfileFacetService.getAll()).map(f => f.id)).toContain('facet_d28_pasted_cite');
  });

  // Самопроверка 26.10 (независимый читатель, пункт 1): `AIProfileService.generate`
  // фильтровал грани СВОЕЙ копией правила по одним `noteIds` и не знал про
  // `dialogueIds` — то есть пересказ диалога о скрытой заметке, который `getAll`
  // прячет, портрет всё равно отправлял провайдеру.
  it('портрет не получает пересказ грани с диалогом о скрытой заметке', async () => {
    await seed();
    await writeFacetStore(async store => {
      await store.put(facet('facet_d28_clean_b', [DOC_V1, DOC_V2], 'второй чистый пересказ D28'));
      await store.put(facet('facet_d28_clean_c', [DOC_V1], 'третий чистый пересказ D28'));
    });
    const chat = vi.spyOn(AIService, 'chat').mockResolvedValue({ ok: true, text: 'раздел портрета' } as never);

    await AIProfileService.generate();

    const sent = chat.mock.calls.map(c => JSON.stringify(c[0])).join('\n');
    expect(sent, 'портрету нечего отправлять — проверка пустая').toContain('второй чистый пересказ D28');
    expect(sent).not.toContain('СКРЫТАЯ_ДЕТАЛЬ_D28');
  });

  // Самопроверка 26.10: страж добавляет чтение `aiDialogues` (самое большое
  // хранилище ИИ: 300 диалогов ≈ 2,6 МБ, замер fake-indexeddb). При
  // ff_dialogues_in_facets по умолчанию ни одна грань диалогов не несёт, и
  // платить этот чтение на каждый ход нельзя.
  it('ни одна грань не ссылается на диалоги — aiDialogues не читаем', async () => {
    const db = await getLocalDb();
    await db.put('documents', doc(DOC_V1));
    await markAllAnalysed(db);
    await db.put('documents', doc(DOC_V2));
    await markAllAnalysed(db);
    await writeFacetStore(async store => {
      await store.put(facet('facet_d28_notes_only_a', [DOC_V1, DOC_V2], 'по заметкам'));
      await store.put(facet('facet_d28_notes_only_b', [DOC_V1], 'по одной заметке'));
    });
    const reads: string[] = [];
    const origGetAll = db.getAll.bind(db);
    vi.spyOn(db, 'getAll').mockImplementation((storeName: string, ...args: unknown[]) => {
      reads.push(storeName);
      return origGetAll(storeName as never, ...(args as [never]));
    });

    expect((await AIProfileFacetService.getAll()).length).toBe(2);
    expect(reads.filter(s => s === 'aiDialogues'), `чтение диалогов зря: ${reads.join(', ')}`).toHaveLength(0);
  });

  it('грани с dialogueIds есть — список диалогов читается один раз на вызов', async () => {
    await seed();
    const db = await getLocalDb();
    const reads: string[] = [];
    const origGetAll = db.getAll.bind(db);
    vi.spyOn(db, 'getAll').mockImplementation((storeName: string, ...args: unknown[]) => {
      reads.push(storeName);
      return origGetAll(storeName as never, ...(args as [never]));
    });

    await AIProfileFacetService.getAll();
    expect(reads.filter(s => s === 'aiDialogues')).toHaveLength(1);
  });
});
