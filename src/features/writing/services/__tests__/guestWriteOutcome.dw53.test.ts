// DW5-3.2 (находка ревью кода 0.11.5): гостевой писатель выбрасывает итог
// `applyWrite`. `GuestDraftService.ts:23,29` зовут мутатора и не смотрят на
// результат, а `useDraftManager.ts:91` по разрешившемуся промису ставит
// «Сохранено» (N-33 запрещает показывать «Сохранено» по пропуску). Отказ по
// эпохе после «Сохранить» и отказ без владельца значит для гостя «текст не
// записан», а он видит обратное.
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetDbInstance, getOrCreateGuestId } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { applySave, getDraftGeneration, applyDelete } from '../../services/draftWriter';
import { saveGuestDraftToStorage } from '../../services/GuestDraftService';
import { useDraftManager, type DraftData } from '../../hooks/useDraftManager';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const T0 = 1_800_000_000_000;
const GUEST = 'guest_dw53';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  vi.clearAllMocks();
  Date.now = () => T0 - 60_000;
  useContentStore.setState({ content: '', title: '', wordCount: 0, ownerUid: null });
  useTimerStore.setState({ status: 'writing' });
});

async function guestRow(): Promise<Record<string, unknown> | undefined> {
  const db = await getLocalDb();
  return (await db.get('drafts', 'guest_draft')) as Record<string, unknown> | undefined;
}

describe('DW5-3.2: гостевой писатель возвращает итог мутатора', () => {
  it('запись с эпохой до сохранения возвращает stale-epoch и не трогает ни один гостевой адрес', async () => {
    applySave(GUEST);
    const epochAtEdit = getDraftGeneration(GUEST);
    const written = await saveGuestDraftToStorage(
      { content: 'MARKER_dw53_гостевая_отсрочка', title: '', timestamp: T0 - 20_000 },
      { uid: GUEST, epoch: epochAtEdit },
    );
    expect(written, 'обычная гостевая запись не вернула итог').toBe('written');

    await applyDelete(getOrCreateGuestId(), 'close', { guest: true });
    // «Сохранить» поднял эпоху — опоздавшая отсрочка обязана быть отвергнута.
    applySave(GUEST);

    const late = await saveGuestDraftToStorage(
      { content: 'MARKER_dw53_гостевая_отсрочка', title: '', timestamp: T0 - 10_000 },
      { uid: GUEST, epoch: epochAtEdit },
    );
    expect(late, 'опоздавшая гостевая запись не вернула отказ').toBe('stale-epoch');
    expect(await guestRow(), 'опоздавшая запись вернула строку guest_draft').toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT), 'опоздавшая запись вернула jw_guest_draft').toBeNull();
  });

  it('отказ без названного владельца возвращает no-owner', async () => {
    const outcome = await saveGuestDraftToStorage(
      { content: 'MARKER_dw53_без_uid', title: '', timestamp: T0 - 20_000 },
      {} as { uid: string },
    );
    expect(outcome, 'запись без uid прошла молча').toBe('no-owner');
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT), 'запись без uid что-то написала в ключ').toBeNull();
  });
});

describe('DW5-3.2: гостевой менеджер не рапортует «Сохранено» по отказу', () => {
  const data: DraftData = { content: 'MARKER_dw53_менеджер', title: '', pinnedThoughts: [], seconds: 5, wpm: 10, wordCount: 2 };

  it('stale-epoch — не «Сохранено»', async () => {
    useContentStore.setState({ content: data.content, title: '' });
    const onSaveDraft = vi.fn().mockResolvedValue('stale-epoch');
    const { result } = renderHook(() => useDraftManager(GUEST, () => data, { onSaveDraft }));
    await act(async () => { await new Promise(r => setTimeout(r, 1_200)); });
    // Не «Сохранено» (N-33) и не «ошибка»: пропуск по эпохе — штатный итог,
    // каким он выглядит у аккаунта. Мутация «оставить только не-saved» краснеет.
    expect(result.current.saveStatus, 'пропуск показан не как штатный idle').toBe('idle');
  });

  it('no-owner — ошибка, а не «Сохранено»', async () => {
    useContentStore.setState({ content: `${data.content} ещё`, title: '' });
    const onSaveDraft = vi.fn().mockResolvedValue('no-owner');
    const { result } = renderHook(() => useDraftManager(GUEST, () => data, { onSaveDraft }));
    await act(async () => { await new Promise(r => setTimeout(r, 1_200)); });
    expect(result.current.saveStatus, 'отказ без владельца не показан сохранённым').toBe('error');
  });
});
