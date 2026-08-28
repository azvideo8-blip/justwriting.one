import { reportError } from '../../shared/errors/reportError';

export type DomainEvent =
  | { type: 'note.deleted'; documentId: string }
  | { type: 'note.excludedFromAI'; documentId: string; excluded: boolean }
  | { type: 'account.reset'; userId?: string }
  | { type: 'sync.restoredFromCloud'; userId: string }
  | { type: 'ai.indexPending'; userId?: string };

type DomainEventHandler = (e: DomainEvent) => void | Promise<void>;

const handlers = new Set<DomainEventHandler>();

export function onDomainEvent(fn: DomainEventHandler): () => void {
  handlers.add(fn);
  return () => {
    handlers.delete(fn);
  };
}

export function emitDomainEvent(e: DomainEvent): void {
  for (const h of handlers) {
    try {
      const res = h(e);
      if (res && typeof (res as Promise<void>).catch === 'function') {
        (res as Promise<void>).catch(err => {
          reportError(err, { action: 'domainEvent_handler_failed', eventType: e.type });
        });
      }
    } catch (err) {
      reportError(err, { action: 'domainEvent_handler_failed', eventType: e.type });
    }
  }
}

/** For tests only */
export function _resetDomainEventHandlersForTests(): void {
  handlers.clear();
}
