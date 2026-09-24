import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportError } from '../reportError';
import { useActivityLogStore } from '../../activity/useActivityLogStore';

describe('reportError PII stripping (SEC-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useActivityLogStore.getState().clearLog();
    localStorage.clear();
  });

  it('strips title, content, and PII keys from activity log entries', () => {
    reportError(new Error('export failed'), {
      action: 'export_to_pdf',
      title: 'Развод, день 4',
      content: 'Секретный текст заметки',
      docTitle: 'Мой дневник',
      text: 'Личные мысли',
      rawContent: 'Исходник',
      summary: 'Краткое содержание',
      userId: 'user_123',
      documentId: 'doc_456',
      method: 'toPDF',
      titleLength: 14,
    });

    const entries = useActivityLogStore.getState().entries;
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry.context).toBeDefined();

    // Sensitive keys must NOT be present in context
    expect(entry.context?.title).toBeUndefined();
    expect(entry.context?.content).toBeUndefined();
    expect(entry.context?.docTitle).toBeUndefined();
    expect(entry.context?.text).toBeUndefined();
    expect(entry.context?.rawContent).toBeUndefined();
    expect(entry.context?.summary).toBeUndefined();
    expect(entry.context?.userId).toBeUndefined();
    expect(entry.context?.documentId).toBeUndefined();

    // Safe metadata must be preserved
    expect(entry.context?.method).toBe('toPDF');
    expect(entry.context?.titleLength).toBe(14);
    expect(entry.context?.action).toBe('export_to_pdf');
  });

  // Ноутбук проснулся без сети — фоновые запросы падают с «Failed to fetch» и
  // повторяются сами. Красная «ОШИБКА» в журнале пугала на ровном месте.
  it('logs a browser network failure as a warning, other errors stay errors', () => {
    reportError(new TypeError('Failed to fetch'), { action: 'restoreAIData_summaries' });
    reportError(new TypeError('Load failed'), { action: 'restoreAIData_summaries' });
    reportError(new TypeError("Cannot read properties of undefined (reading 'x')"), { action: 'bug' });
    const levels = useActivityLogStore.getState().entries.map(e => e.level);
    expect(levels.filter(l => l === 'warning')).toHaveLength(2);
    expect(levels.filter(l => l === 'error')).toHaveLength(1);
  });
});
