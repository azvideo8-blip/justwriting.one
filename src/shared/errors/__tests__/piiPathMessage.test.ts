// AUD-16/17: `path` нёс uid внутри значения мимо фильтра по имени ключа, а
// сообщение ошибки сохранялось как есть. Теперь path/docPath в PII_KEYS,
// наружу идёт только коллекция, а сообщение прогоняется через redaction трёх
// форм: uuid, email, длинный base64.
// Фальсификация: убрать 'path' из PII_KEYS или вызов redactMessage — тесты
// краснеют.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addError = vi.fn();
vi.mock('../../activity/useActivityLogStore', () => ({
  useActivityLogStore: { getState: () => ({ addError }) },
}));

vi.mock('@sentry/react', () => ({
  withScope: vi.fn(),
  captureException: vi.fn(),
}));

import { reportError } from '../reportError';
import { redactMessage, scrubPii } from '../piiScrub';
import { OperationType } from '../errorTypes';
import { handleFirestoreError } from '../../../core/errors/firestore-errors';

const UUID = '00000000-0000-4000-8000-0000000000ff';

describe('AUD-16 path does not reach the log', () => {
  beforeEach(() => {
    addError.mockClear();
  });

  it('stores the collection shape, not the full document path', () => {
    handleFirestoreError(new Error('boom'), OperationType.GET, `users/${UUID}`);
    const ctx = addError.mock.calls[0]![1] as Record<string, unknown>;
    expect(ctx.collection).toBe('users');
    expect(JSON.stringify(ctx)).not.toContain(UUID);
    expect(JSON.stringify(ctx)).not.toContain(`users/${UUID}`);
  });

  it("scrubs 'path' and 'docPath' keys by name", () => {
    const out = scrubPii({ path: `users/${UUID}`, docPath: 'documents/x', operationType: 'get' as const });
    expect(out.path).toBeUndefined();
    expect(out.docPath).toBeUndefined();
    expect(out.operationType).toBe('get');
  });
});

describe('AUD-17 message-shape redaction', () => {
  beforeEach(() => {
    addError.mockClear();
  });

  it('redacts uuid, email and base64 blob inside the message', () => {
    reportError(`Failed to load user ${UUID} for test@example.com`, {});
    const stored = String(addError.mock.calls[0]![0]);
    expect(stored).toContain('<uuid>');
    expect(stored).toContain('<email>');
    expect(stored).not.toContain(UUID);
    expect(stored).not.toContain('test@example.com');
  });

  it('redacts long base64 runs', () => {
    const blob = 'A'.repeat(60);
    expect(redactMessage(`payload ${blob} end`)).toContain('<blob>');
  });

  it('keeps ordinary error text intact', () => {
    expect(redactMessage('Network request failed with status 500')).toBe(
      'Network request failed with status 500',
    );
  });
});
