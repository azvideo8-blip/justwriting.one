import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, type AIDialogue, type AIDialogueEvent, type LocalDocument } from '../../../../core/storage/localDb';
import { getCurrentUser } from '../../../../core/auth';
import { _resetAuthStateForTesting } from '../../../../core/auth/supabaseAuthProvider';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { DataProvider } from '../../../../core/data';
import { invalidateEmbeddingIndexCache } from '../../../../core/services/embeddingIndexCache';
import { AIService } from '../AIService';
import { AIProfileFacetBuilder } from '../AIProfileFacetBuilder';
import { AIProfileFacetSummarizer } from '../AIProfileFacetSummarizer';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

// DY6-3 (приёмка 26.10, Н-2): продюсер граней брал aiDialogueEvents целиком и
// клал `event.summary` в `_excerptSeed` → `AIService.summarizeFacet`, а страж
// видимости диалогов жил только в `AIProfileFacetService.getAll` на чтении.
// Пересказ диалога о скрытой заметке уезжал провайдеру на сборке профиля при
// `ff_dialogues_in_facets=true`. Правило — ОДНА функция на сборщика и сервис
// (урок b5446718: две копии разъезжаются).
//
// Мутация: заборать фильтр событий в сборщике — «в аргументах summarizeFacet
// текста скрытого диалога нет» красный; контроль (чистый диалог доходит) не
// даёт тесту пройти вакуумно.

const auth = vi.hoisted(() => ({ callback: (_event: string, _session: unknown) => {} }));
vi.mock('../../../../core/supabase/client', () => ({ getSupabase: () => ({ auth: {
  onAuthStateChange: (callback: typeof auth.callback) => {
    auth.callback = callback;
    return { data: { subscription: { unsubscribe() {} } } };
  },
} }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const uid = 'dy63-facet-user';
const now = Date.UTC(2026, 9, 20);
const V1 = 'dy63_note_v1';
const V2 = 'dy63_note_v2';
const HID = 'dy63_note_hidden';
const DLG_CLEAN = 'dy63_dlg_clean';
const DLG_HIDDEN = 'dy63_dlg_hidden';
const DLG_TOPIC = 'dy63_dlg_topic';
const CLEAN_TEXT = 'ДИАЛОГ_ЧИСТЫЙ_DY63: прогулка и метроном';
const HIDDEN_TEXT = 'ДИАЛОГ_СКРЫТЫЙ_DY63: разбор про [#dy63-hidden-marker]';
const NOTE_TEXT = 'Синтетическая прогулка в парке с метрономом и разговором о цене урока.';

const doc = (id: string, extra: Partial<LocalDocument> = {}): LocalDocument => ({
  id, uuid: `uuid-${id}`, guestId: uid, title: id, currentVersion: 1, totalWords: 40,
  totalDuration: 1, sessionsCount: 1, firstSessionAt: now, lastSessionAt: now, tags: [], ...extra,
});

const dialogue = (id: string, content: string, extra: Partial<AIDialogue> = {}): AIDialogue => ({
  id, title: id, personaId: 'cbt', personaName: 'Аналитик', personaEmoji: '🙂',
  messages: [
    { role: 'user', content: 'Что ты видишь?' },
    { role: 'assistant', content },
  ],
  createdAt: now, updatedAt: now, ...extra,
});

const event = (dialogueId: string, summary: string): AIDialogueEvent => ({
  dialogueId, date: '2026-10-20', month: '2026-10', personaId: 'cbt', personaName: 'Аналитик',
  summary, themes: ['прогулка'], vector: [1, 0],
});

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings', 'aiDialogues', 'aiDialogueEvents', 'aiProfileFacets', 'aiTimeline'] as const) {
    await db.clear(store);
  }
  // Корпус шире кластера: discovery-грань живёт только когда её заметки < 40 %
  // всех (иначе это «портрет одного дня», не тема).
  await db.put('documents', doc(V1));
  await markAllAnalysed(db);
  await db.put('documents', doc(V2));
  await markAllAnalysed(db);
  // Фон растёт отдельным облаком ([10,±1..3] косинусно близко друг к другу,
  // далеко от [1,±1]) — иначе k-means сливает всё в одну грань на 100 % корпуса.
  for (let i = 0; i < 7; i++) {
    await db.put('documents', doc(`dy63_note_other_${i}`));
    await markAllAnalysed(db);
    await db.put('aiEmbeddings', { documentId: `dy63_note_other_${i}`, vectors: [[10, (i % 2 === 0 ? 1 : -1) * (1 + (i % 3))]], chunkTexts: [`Синтетическая заметка ${i} про ремонт кухни и счета за материалы.`], model: 'test', dim: 2, contentHash: `h-o${i}`, processedAt: now });
  }
  await db.put('documents', doc(HID, { excludedFromAI: true }));
  await markAllAnalysed(db);
  for (const [i, id] of [V1, V2].entries()) {
      await db.put('aiEmbeddings', { documentId: id, vectors: [i === 0 ? [1, 0] : [1, 0.15]], chunkTexts: [NOTE_TEXT], model: 'test', dim: 2, contentHash: `h-${id}`, processedAt: now });
  }
  // Диалог, цитирующий скрытую заметку; диалог-тема о скрытой заметке; чистый.
  await db.put('aiDialogues', dialogue(DLG_CLEAN, `Про [#${V1} · 2026-10-20] ты писал: «ЧИСТАЯ_ДЕТАЛЬ_DY63»`));
  await db.put('aiDialogues', dialogue(DLG_HIDDEN, `Про [#${HID} · 2026-10-20] ты писал: «СКРЫТАЯ_ДЕТАЛЬ_DY63»`));
  await db.put('aiDialogues', dialogue(DLG_TOPIC, 'Здесь ссылки нет, но тема диалога — скрытая заметка.', { documentId: HID }));
  await db.put('aiDialogueEvents', event(DLG_CLEAN, CLEAN_TEXT));
  await db.put('aiDialogueEvents', event(DLG_HIDDEN, HIDDEN_TEXT));
  await db.put('aiDialogueEvents', event(DLG_TOPIC, 'ДИАЛОГ_ТЕМА_СКРЫТОГО_DY63: про скрытую заметку'));
  localStorage.setItem('ff_dialogues_in_facets', 'true');
}

beforeEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  _resetAuthStateForTesting();
  getCurrentUser();
  auth.callback('SIGNED_IN', { user: { id: uid } });
  setIndexingConsent(uid, 'granted');
  invalidateEmbeddingIndexCache();
  // перпендикулярный вектор доменов: чанки не притягиваются в доменные кластеры,
  // сборка идёт через discovery (тот же путь, что в анализPrivacy.ap2-3).
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]], chunks: ['сид'], model: 'test', dim: 2 } as never);
  vi.spyOn(DataProvider, 'deleteSummary').mockResolvedValue(undefined);
  vi.spyOn(DataProvider, 'deleteEmbedding').mockResolvedValue(undefined);
});
afterEach(() => { _resetAuthStateForTesting(); vi.restoreAllMocks(); });

describe('DY6-3: сборщик граней не отдаёт summarizeFacet пересказы скрытых диалогов', () => {
  it('флаг включён — событие диалога о скрытой заметке не доходит до провайдера, чистое доходит', async () => {
    await seed();
    expect((await AIProfileFacetBuilder.build()).ok).toBe(true);

    const summarize = vi.spyOn(AIService, 'summarizeFacet').mockResolvedValue({ ok: true, label: 'Тема', summary: 'Синтетический результат' });
    await AIProfileFacetSummarizer.summarizePending();
    expect(summarize, 'ни одна грань не пошла в пересказ — тест вакуумный').toHaveBeenCalled();

    const sent = JSON.stringify(summarize.mock.calls);
    expect(sent, 'пересказ диалога о скрытой заметке уехал провайдеру').not.toContain('ДИАЛОГ_СКРЫТЫЙ_DY63');
    expect(sent).not.toContain('ДИАЛОГ_ТЕМА_СКРЫТОГО_DY63');
    expect(sent, 'чистый диалог обязан доходить (контроль)').toContain('ДИАЛОГ_ЧИСТЫЙ_DY63');
  });

  it('собранные грани не несут dialogueId скрытого/тема-скрытого диалога', async () => {
    await seed();
    expect((await AIProfileFacetBuilder.build()).ok).toBe(true);
    const db = await getLocalDb();
    const facets = await db.getAll('aiProfileFacets');
    const allDialogueIds = facets.flatMap(f => f.dialogueIds ?? []);
    expect(allDialogueIds).not.toContain(DLG_HIDDEN);
    expect(allDialogueIds).not.toContain(DLG_TOPIC);
    expect(JSON.stringify(facets)).not.toContain('ДИАЛОГ_СКРЫТЫЙ_DY63');
  });
});
