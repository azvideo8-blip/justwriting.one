// Дейлик 05.11, подозрение 1: копия закрытия вкладки снималась и при отказе мутатора:
// записи не было, а единственная копия текста стиралась.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { persistDraft } from '../draftPersistence';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const UID = 'u_d36_copy';
const draft = (over: Record<string, unknown>) => ({
  userId: UID, owner: UID, content: 'ТЕКСТ', title: '', seconds: 1, wpm: 1, wordCount: 1, pinnedThoughts: [], tags: [],
  activeSessionId: null, savedDocumentId: null, sessionStartTime: null, updatedAt: 1, ...over,
}) as unknown as LocalDraft;

beforeEach(() => {
  localStorage.clear();
  resetDbInstance();
  localStorage.setItem(STORAGE_KEYS.DRAFT(UID), JSON.stringify({ content: 'КОПИЯ_D36', updatedAt: 1 }));
});

describe('persistDraft: копия закрытия вкладки', () => {
  it('мутатор отказал по владельцу: копия остаётся', async () => {
    const res = await persistDraft(draft({ owner: 'u_другой' }), { remote: false });
    expect(res.localSkipOutcome).toBe('owner-mismatch');
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(UID)), 'записи не было, а копию стёрли').not.toBeNull();
  });

  it('контроль: принятая запись копию снимает', async () => {
    const res = await persistDraft(draft({}), { remote: false });
    expect(res.localSkipOutcome).toBe('written');
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(UID))).toBeNull();
  });
});
