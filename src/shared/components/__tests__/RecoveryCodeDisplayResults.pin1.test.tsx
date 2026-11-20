// PIN-1 (дейлик 20.11): окно кода восстановления — копирование и скачивание называют итог своим типом.
// Код показывается один раз: «скопировано/сохранено» зелёным при отказе — потеря доступа.
// Мутации: убрать ветку else в handleCopy (error «не скопировано»); убрать ветку else в handleDownload.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ showToast: vi.fn(), copy: vi.fn(), download: vi.fn() }));

vi.mock('../../i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('../recoveryCodeActions', () => ({
  copyRecoveryCode: (...a: unknown[]) => h.copy(...a),
  downloadRecoveryCode: (...a: unknown[]) => h.download(...a),
}));

import { RecoveryCodeDisplayModal } from '../RecoveryCodeDisplayModal';

const renderModal = () => render(<RecoveryCodeDisplayModal recoveryCode="ABCD-EFGH-IJKL-MNOP-QRST-UVWX" onConfirm={vi.fn()} />);

describe('PIN-1: RecoveryCodeDisplayModal — итог копирования и скачивания', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });

  it('копирование отказало (буфер закрыт) — error «не скопировано», не success', async () => {
    h.copy.mockResolvedValue(false);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /enc_recovery_code_copy_btn/ }));
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('enc_recovery_code_copy_failed', 'error'));
    expect(h.showToast).not.toHaveBeenCalledWith('enc_recovery_code_copied', 'success');
  });

  it('скачивание отказало — error, не «файл сохранён»', async () => {
    h.download.mockReturnValue(false);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /enc_recovery_code_download_btn/ }));
    expect(h.showToast).toHaveBeenCalledWith('error_generic', 'error');
    expect(h.showToast).not.toHaveBeenCalledWith('enc_recovery_file_downloaded', 'success');
  });

  it('КОНТРОЛЬ: удалось — success', async () => {
    h.copy.mockResolvedValue(true);
    h.download.mockReturnValue(true);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /enc_recovery_code_copy_btn/ }));
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('enc_recovery_code_copied', 'success'));
    fireEvent.click(screen.getByRole('button', { name: /enc_recovery_code_download_btn/ }));
    expect(h.showToast).toHaveBeenCalledWith('enc_recovery_file_downloaded', 'success');
    expect(h.showToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });
});
