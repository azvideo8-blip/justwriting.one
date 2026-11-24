// Подозрение дейлика 22.11: список заметок не прочитался — окно выбора говорило «ничего
// не найдено». Мутации: вернуть пустой catch — красный; не сбрасывать loaded — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';

const docs = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/services/LocalDocumentService', () => ({ LocalDocumentService: { getDocumentsByOwner: docs } }));
vi.mock('../../../../core/services/LocalVersionService', () => ({ LocalVersionService: { getLatestPreview: async () => '' } }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_d43' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { DocumentPickerModal } from '../DocumentPickerModal';

const view = () => render(<LanguageProvider><DocumentPickerModal isOpen onClose={vi.fn()} onSelect={vi.fn()} /></LanguageProvider>);

beforeEach(() => { docs.mockReset(); });

describe('выбор заметки: сбой чтения ≠ «ничего не найдено»', () => {
  it('не прочиталось — сказано, нажатие перечитывает', async () => {
    docs.mockRejectedValueOnce(new Error('idb down')).mockResolvedValueOnce([{ id: 'd1', title: 'Синтетика', lastSessionAt: 1 }]);
    view();
    fireEvent.click(await screen.findByText(/Не прочиталось/));
    expect(await screen.findByText('Синтетика')).toBeTruthy();
    expect(screen.queryByText(/Не прочиталось/)).toBeNull();
  });

  it('контроль: заметок нет — «ничего не найдено», без сбоя', async () => {
    docs.mockResolvedValue([]);
    view();
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(screen.getByText(/ничего не найдено/i)).toBeTruthy();
    expect(screen.queryByText(/Не прочиталось/)).toBeNull();
  });
});
