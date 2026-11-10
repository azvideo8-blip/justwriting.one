// Журнал владельца 06.11: «Не удалось синхронизировать» (`Did not write`) за секунду до
// успешного сохранения заметки. Намеренно пропущенная отправка — не сбой.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalDraft } from '../../../../core/storage/localDb';

const { warn, saveDraftToCloud } = vi.hoisted(() => ({ warn: vi.fn(), saveDraftToCloud: vi.fn() }));
vi.mock('../../../../shared/errors/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/WritingDraftService', () => ({
  WritingDraftService: {
    saveToLocal: vi.fn(async () => 'written'),
    saveDraftToCloud,
    clearLegacyDraft: vi.fn(async () => undefined),
  },
}));

import { persistDraft } from '../draftPersistence';

const draft = { userId: 'u1', owner: 'u1', content: 'текст' } as unknown as LocalDraft;

beforeEach(() => {
  warn.mockClear();
  saveDraftToCloud.mockReset();
});

describe('журнал отправки черновика в облако', () => {
  it('отправку намеренно не делали: журнал молчит, отставание облака видно вызывающему', async () => {
    saveDraftToCloud.mockResolvedValue(false);
    const res = await persistDraft(draft, { remote: true });
    expect(warn).not.toHaveBeenCalled();
    expect(res.remoteOk).toBe(false);
  });

  it('настоящий сбой: журнал говорит', async () => {
    saveDraftToCloud.mockRejectedValue(new Error('Failed to fetch'));
    const res = await persistDraft(draft, { remote: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(res.remoteOk).toBe(false);
  });
});
