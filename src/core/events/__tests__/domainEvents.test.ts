import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onDomainEvent, emitDomainEvent, _resetDomainEventHandlersForTests, DomainEvent } from '../domainEvents';
import { reportError } from '../../../shared/errors/reportError';

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('domainEvents', () => {
  beforeEach(() => {
    _resetDomainEventHandlersForTests();
    vi.clearAllMocks();
  });

  it('delivers events to registered subscribers', () => {
    const received: DomainEvent[] = [];
    const unsub = onDomainEvent((e) => {
      received.push(e);
    });

    emitDomainEvent({ type: 'note.deleted', documentId: 'doc_123' });
    expect(received).toEqual([{ type: 'note.deleted', documentId: 'doc_123' }]);

    unsub();
    emitDomainEvent({ type: 'note.deleted', documentId: 'doc_456' });
    expect(received).toHaveLength(1);
  });

  it('calls reportError and does not throw when a synchronous subscriber fails', () => {
    const error = new Error('sync failure in subscriber');
    onDomainEvent(() => {
      throw error;
    });

    const goodSubscriber = vi.fn();
    onDomainEvent(goodSubscriber);

    expect(() => {
      emitDomainEvent({ type: 'note.deleted', documentId: 'doc_fail' });
    }).not.toThrow();

    expect(reportError).toHaveBeenCalledWith(error, {
      action: 'domainEvent_handler_failed',
      eventType: 'note.deleted',
    });
    expect(goodSubscriber).toHaveBeenCalledWith({ type: 'note.deleted', documentId: 'doc_fail' });
  });

  it('calls reportError and does not throw when an async subscriber rejects', async () => {
    const asyncError = new Error('async failure in subscriber');
    onDomainEvent(async () => {
      throw asyncError;
    });

    emitDomainEvent({ type: 'note.excludedFromAI', documentId: 'doc_async', excluded: true });

    // Allow promise microtasks to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(reportError).toHaveBeenCalledWith(asyncError, {
      action: 'domainEvent_handler_failed',
      eventType: 'note.excludedFromAI',
    });
  });
});
