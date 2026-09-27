import { describe, it, expect, beforeEach } from 'vitest';
import { describeError } from '../describeError';
import { reportError } from '../reportError';
import { useActivityLogStore } from '../../activity/useActivityLogStore';

describe('ошибки в журнале — по-русски, исходник — в контексте', () => {
  beforeEach(() => useActivityLogStore.getState().clearLog());

  it('запертый сейф узнаётся и по тексту, и по причине в контексте', () => {
    const vault = /сейф заблокирован/;
    expect(describeError('ENCRYPT_REQUIRED: session key not available')).toMatch(vault);
    expect(describeError('LOCKED: session key not available')).toMatch(vault);
    expect(describeError('Sync failed', { reason: 'Error: ENCRYPT_REQUIRED: session key not available' })).toMatch(vault);
    expect(describeError('Sync task quarantined', { reason: 'Error: ENCRYPT_REQUIRED: session key not available' })).toMatch(vault);
    expect(describeError('Cloud sync failed, task remains in syncQueue', { error: 'Error: ENCRYPT_REQUIRED: session key not available' })).toMatch(vault);
  });

  it('«заметка занята другой вкладкой» — не сейф', () => {
    expect(describeError('LOCK_HELD: Document x is currently locked')).not.toMatch(/сейф/);
  });

  it('числа в контексте не выдают себя за код ответа', () => {
    expect(describeError('Something odd', { bytes: 512, attempts: 403 })).toMatch(/Техническая ошибка/);
  });

  it('русский текст не переводится', () => {
    expect(describeError('заметка удалена навсегда')).toBeNull();
  });

  it('reportError пишет русское описание, а английский исходник — в raw', () => {
    reportError(new Error('ENCRYPT_REQUIRED: session key not available'), { action: 'ai_summary_cloud_save' });
    const e = useActivityLogStore.getState().entries[0]!;
    expect(e.message).toMatch(/сейф заблокирован/);
    expect(e.context?.['raw']).toBe('ENCRYPT_REQUIRED: session key not available');
    expect(e.context?.['action']).toBe('ai_summary_cloud_save');
  });

  it('N-75: describeError поддерживает английский язык (lang = "en")', () => {
    expect(describeError('ENCRYPT_REQUIRED: session key not available', undefined, 'en')).toMatch(/Vault may be locked/);
    expect(describeError('LOCK_HELD', undefined, 'en')).toMatch(/syncing in another tab/);
    expect(describeError('Unknown error', undefined, 'en')).toMatch(/Technical error/);
  });
});
