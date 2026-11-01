// DY10-10 (CI 30.10, run 41024996655): сохранил заметку, быстро перезагрузил —
// в редакторе снова сохранённый текст с плашкой «Черновик восстановлен».
//
// Порядок в handleSave: savedDocumentId → стирание черновика (поколение поднято,
// строка удалена, надгробие) → сброс сессии. Между стиранием и сбросом stores
// ещё полны, и на медленной сети это окно длится секунды: отсроченное
// автосохранение срабатывает в нём и пишет сохранённый текст обратно. Запись
// шла с текущим поколением, поэтому защита поколения её пропускала, а надгробие
// не ловило: хэш нагрузки уже другой (savedDocumentId заполнен), а метка строки
// новее отметки удаления.
//
// Здесь три писателя, у которых окно общее: отсрочка, уход в фон (облако) и
// уход со страницы (унаследованный ключ localStorage).
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import type { AppUser } from '../../../../core/auth/types';
import { WritingDraftService } from '../../services/WritingDraftService';
import { cleanupDraftsAfterSave } from '../../utils/sessionActions';
import { useContentStore } from '../../store/useContentStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useDraftAutosave } from '../useDraftAutosave';
import { buildLocalDraft } from '../../utils/draftPersistence';

// Облачная синхронизация включена: сценарий DY10-10 — зарегистрированный
// человек с связью, у которого черновик живёт и локально, и в облаке. С
// выключенной синхронизацией `saveDraftToCloud` выходит на первой же строке, и
// проверка облачной записи была бы зелёной вакуумно.
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/auth/accountReload', () => ({
  onBeforeAccountReload: () => () => {},
  isAccountReloadPending: () => false,
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const cloud = vi.hoisted(() => ({ saves: 0, deletes: 0, failDeletes: false, row: null as Record<string, unknown> | null }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => cloud.row,
    saveDraft: async () => { cloud.saves++; return null; },
    updateDraft: async () => {},
    deleteDraft: async () => {
      cloud.deletes++;
      if (cloud.failDeletes) throw new Error('DY1010 cloud delete refused');
      cloud.row = null;
    },
  },
}));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncOne: vi.fn().mockResolvedValue('dy1010-cloud-doc'),
    addToQueue: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));

const UID = 'u_dy1010';
const user = { uid: UID } as AppUser;
const TEXT = 'DY1010 текст, который человек сохранил заметкой';
const NEW_TEXT = 'DY1010 новая запись, начатая после сохранения';

const draftData = {
  title: '',
  content: TEXT,
  pinnedThoughts: [] as string[],
  seconds: 5,
  wpm: 12,
  wordCount: 6,
  initialWordCount: 0,
  sessionStartTime: undefined,
  activeSessionId: null,
  status: 'writing' as const,
};

async function localRow(): Promise<LocalDraft | undefined> {
  const db = await getLocalDb(UID);
  return db.objectStoreNames.contains('drafts') ? await db.get('drafts', UID) : undefined;
}

/** Отсрочка локальной записи на телефоне — 1 с (useDraftAutosave.ts). */
const DEBOUNCE_MS = 1_300;

const settle = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

const onlineDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

/**
 * Окно из handleSave: savedDocumentId → стирание черновика → (сброс сессии ещё
 * не состоялся, текст в stores тот же). Именно в этом окне срабатывает
 * отсроченная запись.
 */
async function enterPostSaveWindow(): Promise<void> {
  useSessionMetaStore.getState().setSavedDocumentId('dy1010-doc');
  await act(async () => { await cleanupDraftsAfterSave(UID, false, null); });
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  cloud.saves = 0;
  cloud.deletes = 0;
  cloud.failDeletes = false;
  cloud.row = null;
  useContentStore.setState({ content: TEXT, title: '', wordCount: 6, tags: [], labelId: undefined, ownerUid: UID });
  useTimerStore.setState({ status: 'writing' });
  useSessionMetaStore.getState().resetSessionMetadata();
  useEncryptionStore.setState({ encryptionEnabled: {} });
  const db = await getLocalDb(UID);
  await db.clear('drafts');
  WritingDraftService.bumpDraftGeneration(UID);
});

afterEach(() => {
  vi.restoreAllMocks();
  // setOnline вешает свойство на сам `navigator`, и оно затеняет прототип:
  // без удаления офлайн-тест оставлял `onLine=false` следующему тесту.
  delete (navigator as { onLine?: unknown }).onLine;
  if (onlineDescriptor) Object.defineProperty(Navigator.prototype, 'onLine', onlineDescriptor);
});

describe('DY10-10: запись черновика после сохранения заметки', () => {
  it('отсроченное автосохранение, сработавшее в окне после стирания, черновик не возвращает', async () => {
    renderHook(() => useDraftAutosave(user, draftData));
    // Таймер отсрочки поставлен и ещё не сработал.
    await settle(10);
    expect(await localRow(), 'до сохранения записи нет').toBeUndefined();

    await enterPostSaveWindow();
    await settle(DEBOUNCE_MS);

    expect(await localRow(), 'сохранённый текст вернулся черновиком').toBeUndefined();
  });

  it('уход в фон в том же окне не пишет черновик в облако', async () => {
    renderHook(() => useDraftAutosave(user, draftData));
    await settle(10);

    await enterPostSaveWindow();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle(50);

    expect(cloud.saves, 'облачная копия стёртого черновика записана снова').toBe(0);
    expect(await localRow(), 'локальная строка вернулась').toBeUndefined();
  });

  it('уход со страницы в том же окне не кладёт сохранённый текст в унаследованный ключ', async () => {
    renderHook(() => useDraftAutosave(user, draftData));
    await settle(10);

    await enterPostSaveWindow();
    await act(async () => { window.dispatchEvent(new Event('beforeunload')); });

    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(UID)), 'унаследованный ключ вернулся после удаления').toBeNull();
  });

  // Вторая половина правки. В браузере хук перерисовывается каждую секунду
  // (тикают `seconds` и `wpm`), и прежний эффект обновлял поколение на каждый
  // рендер — токен становился текущим раньше, чем отсрочка срабатывала. Тест без
  // перерисовки эту половину не видел бы. Мутация: вернуть обновление ссылки на
  // каждый рендер — этот тест красный.
  it('тик таймера в окне не обновляет токен поколения — отсроченная запись отвергнута', async () => {
    const { rerender } = renderHook(
      ({ data }: { data: typeof draftData }) => useDraftAutosave(user, data),
      { initialProps: { data: draftData } },
    );
    await settle(10);

    await enterPostSaveWindow();
    // Текст тот же, секунды и скорость выросли — так выглядит рендер в окне.
    rerender({ data: { ...draftData, seconds: draftData.seconds + 1, wpm: draftData.wpm + 1 } });
    await settle(DEBOUNCE_MS);

    expect(await localRow(), 'сохранённый текст вернулся черновиком после тика').toBeUndefined();
  });
});

describe('DY10-10: настоящий черновик после сохранения не теряет записи', () => {
  it('человек начал новый текст — после отсрочки новый черновик записан', async () => {
    const { rerender } = renderHook(
      ({ data }: { data: typeof draftData }) => useDraftAutosave(user, data),
      { initialProps: { data: draftData } },
    );
    await settle(10);

    await enterPostSaveWindow();
    // Новая сессия: текст другой, служебных полей сохранённой заметки нет.
    useContentStore.setState({ content: NEW_TEXT, wordCount: 6 });
    useSessionMetaStore.getState().resetSessionMetadata();
    rerender({ data: { ...draftData, content: NEW_TEXT } });
    await settle(DEBOUNCE_MS);

    expect((await localRow())?.content, 'новая работа не записана черновиком').toBe(NEW_TEXT);
  });

  it('тот же текст после сохранения человек дописал — черновик записан', async () => {
    const { rerender } = renderHook(
      ({ data }: { data: typeof draftData }) => useDraftAutosave(user, data),
      { initialProps: { data: draftData } },
    );
    await settle(10);

    await enterPostSaveWindow();
    const edited = `${TEXT} и ещё одна строка сверху`;
    useContentStore.setState({ content: edited, wordCount: 10 });
    useSessionMetaStore.getState().resetSessionMetadata();
    rerender({ data: { ...draftData, content: edited, wordCount: 10 } });
    await settle(DEBOUNCE_MS);

    expect((await localRow())?.content, 'дописанный текст не записан черновиком').toBe(edited);
  });
});

// §4 билета DY10-10: защита поколения не должна глушить записи, которые
// настоящие. Отказ сохранения и офлайн-финиш — два пути, на которых человек
// ждёт, что текст уцелеет.
describe('DY10-10: §4 — черновик не теряет записи, когда сохранения заметки не состоялось', () => {
  it('сохранение не удалось: отсроченная запись доходит, после перезагрузки текст на месте', async () => {
    const { rerender } = renderHook(
      ({ data }: { data: typeof draftData }) => useDraftAutosave(user, data),
      { initialProps: { data: draftData } },
    );
    await settle(10);

    // `StorageService.saveNew` бросил → catch в useWritingActions: ни
    // `cleanupDraftsAfterSave`, ни `resetSession`. Поколение не поднято.
    await settle(DEBOUNCE_MS);
    expect((await localRow())?.content, 'черновик не записан после отказа сохранения').toBe(TEXT);

    const edited = `${TEXT} и продолжение после неудачи`;
    useContentStore.setState({ content: edited, wordCount: 10 });
    rerender({ data: { ...draftData, content: edited, wordCount: 10 } });
    await settle(DEBOUNCE_MS);

    // Перезагрузка — свежая загрузка черновика: текст человека на месте.
    expect((await WritingDraftService.loadDraft(UID))?.content, 'после перезагрузки текста нет').toBe(edited);
  });

  it('офлайн-финиш: сохранённый текст не возвращается, облачная копия стирается при связи', async () => {
    setOnline(false);
    // Черновик уже записан во время письма — и локально, и в облаке.
    const written = buildLocalDraft(user, draftData);
    await WritingDraftService.saveToLocal(written);
    cloud.row = { ...written } as unknown as Record<string, unknown>;

    renderHook(() => useDraftAutosave(user, draftData));
    await settle(10);

    await enterPostSaveWindow();
    expect(cloud.deletes, 'облако звали без сети').toBe(0);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID)), 'нет отметки досылки').not.toBeNull();

    // Отсроченная запись срабатывает в окне финиша — как в основном сценарии.
    await settle(DEBOUNCE_MS);
    expect(await localRow(), 'сохранённый текст вернулся черновиком').toBeUndefined();

    setOnline(true);
    expect(await WritingDraftService.loadDraft(UID), 'после перезагрузки старое вернулось').toBeNull();
    expect(cloud.deletes, 'облачная копия не стёрта, когда связь вернулась').toBe(1);
  });

  it('облачное удаление не удалось: отсрочка не воскрешает, надгробие глушит живую облачную строку', async () => {
    const written = buildLocalDraft(user, draftData);
    await WritingDraftService.saveToLocal(written);
    cloud.row = { ...written } as unknown as Record<string, unknown>;
    cloud.failDeletes = true;

    renderHook(() => useDraftAutosave(user, draftData));
    await settle(10);

    await enterPostSaveWindow();
    expect(cloud.deletes, 'облачное удаление не позвали').toBe(1);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID)), 'отметка досылки снята после отказа').not.toBeNull();

    await settle(DEBOUNCE_MS);
    expect(await localRow(), 'сохранённый текст вернулся черновиком').toBeUndefined();

    // Облачная строка жива (удаление отказало) — её обязано глушить надгробие,
    // а не часы прибора: метка у неё серверная.
    expect(await WritingDraftService.loadDraft(UID), 'после перезагрузки старое вернулось из облака').toBeNull();
  });
});
