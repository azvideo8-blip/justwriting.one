// Приёмка ai-privacy (код-ревью ветки):
// I-2: уборка шла ПОСЛЕ удаления хронологии — месяц дайджеста находился только
//      по последней сессии, и дайджест месяца разбора (заметку продолжили в
//      другом месяце) оставался. Тест — без мока AISummaryService.delete: именно
//      мок прятал порядок. Мутация: вернуть уборку после удаления — красный.
// M-2: портрет и дайджест стирались при ЛЮБОМ удалении заметки, даже без
//      производных (фоновый откат загрузки, «убрать копию»). Мутация: портрет
//      всегда — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { NoteAnalysisService } from '../NoteAnalysisService';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';
import { purgeNoteDerivatives } from '../../../../core/services/noteDerivativePurge';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

const NOTE = 'doc_purge_sep_oct';
const digest = (month: string, extra: Record<string, unknown> = {}) => ({
  month, narrative: `МАРКЕР-${month}`, tones: [], themes: [], noteCount: 1, generatedAt: Date.now(), ...extra,
});

describe('уборка производных заметки', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete').mockImplementation(() => {});
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
    const db = await getLocalDb();
    for (const s of ['documents', 'aiSummaries', 'aiTimeline', 'aiMonthlyDigest', 'aiPortrait', 'aiProfileFacets'] as const) await db.clear(s);
    localStorage.clear();
  });

  it('I-2: разобрали в сентябре, продолжили в октябре, скрыли — дайджест сентября удалён', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: NOTE, uuid: `uuid_${NOTE}`, guestId: 'guest', title: NOTE, currentVersion: 1, totalWords: 10, totalDuration: 60,
      firstSessionAt: Date.UTC(2026, 8, 10), lastSessionAt: Date.UTC(2026, 9, 12), aiProcessed: true, excludedFromAI: true,
    } as never);
    await db.put('aiTimeline', { documentId: NOTE, date: '2026-09-10', month: '2026-09', facts: ['факт'] } as never);
    await db.put('aiMonthlyDigest', digest('2026-09'));
    await db.put('aiMonthlyDigest', digest('2026-10', { noteIds: [NOTE] }));

    await NoteAnalysisService.clear(NOTE);

    expect(await db.get('aiMonthlyDigest', '2026-09'), 'месяц разбора').toBeUndefined();
    expect(await db.get('aiMonthlyDigest', '2026-10'), 'дайджест, собранный по заметке').toBeUndefined();
  });

  it('M-2: у заметки не было производных — портрет и чужие дайджесты целы', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: 'doc_plain', uuid: 'uuid_plain', guestId: 'guest', title: 'p', currentVersion: 1, totalWords: 1, totalDuration: 1, lastSessionAt: Date.UTC(2026, 8, 3) } as never);
    await db.put('aiPortrait', { id: 'singleton', portrait: 'портрет', updatedAt: 1, generatedAtDelta: 0 } as never);
    await db.put('aiMonthlyDigest', digest('2026-09', { noteIds: ['other'] }));
    await db.put('aiMonthlyDigest', digest('2026-08'));

    await purgeNoteDerivatives('doc_plain');

    expect(await db.get('aiPortrait', 'singleton'), 'портрет').toBeTruthy();
    expect(await db.get('aiMonthlyDigest', '2026-09'), 'дайджест по другим заметкам').toBeTruthy();
  });

  it('M-2: были производные — портрет удалён (в базе устройства, не только в кэше)', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: 'doc_an', uuid: 'uuid_an', guestId: 'guest', title: 'a', currentVersion: 1, totalWords: 1, totalDuration: 1, aiProcessed: true } as never);
    await db.put('aiPortrait', { id: 'singleton', portrait: 'портрет', updatedAt: 1, generatedAtDelta: 0 } as never);

    await purgeNoteDerivatives('doc_an');

    expect(await db.get('aiPortrait', 'singleton')).toBeUndefined();
  });

  // Проверка коммита f8133c92: заметку не разбирали, но о ней был диалог (тема) —
  // память и портрет могли её пересказать. Мутация: без проверки диалогов — красный.
  it('M-2: диалог о заметке — тоже производная, портрет удалён', async () => {
    const db = await getLocalDb();
    await db.clear('aiDialogues');
    await db.put('documents', { id: 'doc_talk', uuid: 'uuid_talk', guestId: 'guest', title: 't', currentVersion: 1, totalWords: 1, totalDuration: 1 } as never);
    await db.put('aiDialogues', { id: 'dlg_talk', documentId: 'doc_talk', title: 'о заметке', personaId: 'coach', personaName: 'К', personaEmoji: 'x', messages: [], createdAt: 1, updatedAt: 1 } as never);
    await db.put('aiPortrait', { id: 'singleton', portrait: 'портрет', updatedAt: 1, generatedAtDelta: 0 } as never);

    await purgeNoteDerivatives('doc_talk');

    expect(await db.get('aiPortrait', 'singleton')).toBeUndefined();
  });
});
