// d41e (Н-5): useProfileLabels.updateLabels глотает отказ ProfileService.updateLabels
// (catch{reportError}, useProfileLabels.ts:80-82): форма создания метки закрывается
// «как будто сохранено» (DocumentPreview:422-430, MobileNoteReader:93-100, бар меток).
// removeLabel (:97-103) после проглоченного отказа продолжает разрушительный шаг —
// clearLabelFromAllDocs в облаке и локально (.catch(reportError)): метка снята с
// заметок, но осталась в профиле. Настоящий хук; моки только края (сервисы профиля/документов).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, act, cleanup } from '@testing-library/react';

const updateLabels = vi.hoisted(() => vi.fn());
const cloudClear = vi.hoisted(() => vi.fn(async () => {}));
const localClear = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/core/services/ProfileService', () => ({
  ProfileService: {
    getProfile: vi.fn(async () => ({ data: { labels: [] }, error: null })),
    updateLabels,
  },
}));
vi.mock('@/core/services/DocumentService', () => ({
  DocumentService: { clearLabelFromAllDocs: cloudClear },
}));
vi.mock('@/core/services/LocalDocumentService', () => ({
  LocalDocumentService: { clearLabelFromAllDocs: localClear },
}));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useProfileLabels } from '@/features/profile/hooks/useProfileLabels';

const LABEL = { id: 'lab_d41e', name: 'MARKER_DAILY_LABEL', color: '#7D4FD1' };

beforeEach(() => { cleanup(); vi.clearAllMocks(); });

describe('d41e: отказ удаления метки не запускает зачистку метки в заметках', () => {
  it('updateLabels отказал — clearLabelFromAllDocs не вызван, метка остаётся в профиле', async () => {
    updateLabels.mockRejectedValue(new Error('MARKER_DAILY_CLOUD_DOWN'));
    const { result } = renderHook(() => useProfileLabels('u-d41e-red', [LABEL]));
    await act(async () => { await result.current.removeLabel('lab_d41e'); });
    expect(updateLabels).toHaveBeenCalled();
    expect(
      cloudClear,
      'метка не удалена из профиля (отказ проглочен), но облачные заметки уже зачищаются — разрушительный шаг после отказа',
    ).not.toHaveBeenCalled();
    expect(localClear).not.toHaveBeenCalled();
  });

  it('КОНТРОЛЬ: профиль ответил — зачистка в облаке и локально выполняется', async () => {
    updateLabels.mockResolvedValue(undefined);
    const { result } = renderHook(() => useProfileLabels('u-d41e-ctl', [LABEL]));
    await act(async () => { await result.current.removeLabel('lab_d41e'); });
    expect(cloudClear).toHaveBeenCalledWith('u-d41e-ctl', 'lab_d41e');
    expect(localClear).toHaveBeenCalledWith('u-d41e-ctl', 'lab_d41e');
  });
});
