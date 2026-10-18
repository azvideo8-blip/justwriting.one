// Наблюдение владельца 2026-10-17 (iPhone): «📅» в ответах ИИ не реагируют.
// В контекст модели идёт ЛОКАЛЬНЫЙ id заметки, а у одной заметки на разных
// устройствах локальные id разные; диалоги синхронизируются. Нажатие искало
// только по локальному id и при промахе молча ничего не делало.
// Теперь: поиск по id, затем по uuid и облачному id; промах — сообщение.
// Мутации: убрать поиск по uuid → красный кейс 1; убрать onMissing → кейс 2.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_cite' }), getCurrentUserId: () => 'u_cite' }));
vi.mock('../../../../../core/services/LocalVersionService', () => ({ LocalVersionService: { getLatestContent: async () => 'Текст заметки.' } }));
const i18n = vi.hoisted(() => ({ t: (k: string) => k }));
vi.mock('../../../../../shared/i18n', () => ({ useLanguage: () => ({ t: i18n.t, language: 'ru' }) }));

const { getLocalDb, resetDbInstance } = await import('../../../../../core/storage/localDb');
const { useCitationMeta } = await import('../useCitationMeta');

describe('ссылка на заметку из ответа ИИ', () => {
  beforeEach(async () => {
    resetDbInstance();
    const db = await getLocalDb();
    await db.clear('documents');
    await db.put('documents', {
      id: 'local_phone', uuid: 'uuid-shared', linkedCloudId: 'cloud-1', guestId: 'u_cite', title: 'Т',
      currentVersion: 1, totalWords: 2, totalDuration: 60, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
    } as never);
  });

  it('ссылка по uuid или облачному id открывает заметку этого устройства', async () => {
    const setPreview = vi.fn();
    const { result } = renderHook(() => useCitationMeta([], null, setPreview, vi.fn()));
    result.current.handleCitationClick('uuid-shared');
    await waitFor(() => expect(setPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'local_phone' })));
    setPreview.mockClear();
    result.current.handleCitationClick('cloud-1');
    await waitFor(() => expect(setPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'local_phone' })));
  });

  it('заметки нет на устройстве — сообщение, а не тишина', async () => {
    const setPreview = vi.fn();
    const onMissing = vi.fn();
    const { result } = renderHook(() => useCitationMeta([], null, setPreview, onMissing));
    result.current.handleCitationClick('local_laptop_only');
    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
    expect(setPreview).not.toHaveBeenCalled();
  });
});
