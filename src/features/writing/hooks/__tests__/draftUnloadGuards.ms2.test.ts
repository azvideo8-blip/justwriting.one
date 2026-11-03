// MS-2: выгрузка вкладки (pagehide/beforeunload). Настоящий useSyncUnloadSave;
// мокаются только признак смены аккаунта и отчёт об ошибках. Синтетические
// маркеры MARKER_MS2_*, живых данных нет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { accountReloadPending } = vi.hoisted(() => ({ accountReloadPending: { value: false } }));
vi.mock('../../../../core/auth/accountReload', () => ({
  isAccountReloadPending: () => accountReloadPending.value,
  onBeforeAccountReload: () => () => {},
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useSyncUnloadSave } from '../useDraftCore';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import { clearEditorTextOwner, markEditorTextOwner } from '../../services/draftWriter';
import type { AppUser } from '../../../../core/auth/types';

const UID = 'u_ms2_unload';
const user = { uid: UID } as AppUser;
const KEY = `draft-${UID}`;
const TEXT = 'MARKER_MS2_текст_выгрузки';

function mount(content = TEXT): void {
  const ref = {
    current: {
      pinnedThoughts: [] as string[],
      sessionStartTime: undefined,
      activeSessionId: null,
      content,
    },
  };
  renderHook(() => useSyncUnloadSave(user, ref as never));
}

function unload(): void {
  window.dispatchEvent(new Event('pagehide'));
}

beforeEach(() => {
  localStorage.clear();
  accountReloadPending.value = false;
  useContentStore.setState({ content: TEXT, title: '', wordCount: 2, ownerUid: UID });
  // DW4-4: владелец текста — зеркало редактора; стор остаётся до шага 7.
  markEditorTextOwner(UID);
  useTimerStore.setState({ status: 'writing', seconds: 7 });
  useSessionMetaStore.getState().resetSessionMetadata();
  useEncryptionStore.setState({ encryptionEnabled: {} });
});

describe('MS-2: выгрузка вкладки', () => {
  it('во время смены аккаунта унаследованный ключ не пишется', () => {
    mount();
    accountReloadPending.value = true;
    unload();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('с сейфом открытый текст не кладётся в localStorage, старый ключ стирается', () => {
    useEncryptionStore.setState({ encryptionEnabled: { [UID]: true } });
    localStorage.setItem(KEY, 'MARKER_MS2_старый_открытый');
    mount();
    unload();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('чужой текст не подписывается текущим аккаунтом', () => {
    useContentStore.setState({ content: 'MARKER_MS2_чужой', ownerUid: 'u_other' });
    markEditorTextOwner('u_other');
    mount('MARKER_MS2_чужой');
    unload();
    expect(localStorage.getItem(KEY)).toBeNull();
    clearEditorTextOwner();
  });

  it('неизменённая сохранённая заметка не воскресает черновиком', () => {
    useSessionMetaStore.getState().setSavedDocumentId('doc_ms2');
    useSessionMetaStore.getState().setLoadedBaseline(TEXT, '');
    mount();
    unload();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
