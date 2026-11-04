import type { AppUser } from '../../../core/auth/types';
import { LocalDraft } from '../../../core/storage/localDb';
import { WritingDraftService } from '../services/WritingDraftService';
import { getLocalStorageUsageKB } from '../../../shared/lib/localStorageUtils';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { getEditorTextOwner, type ApplyWriteOutcome } from '../services/draftWriter';
import { logger } from '../../../shared/errors/logger';


export function buildLocalDraft(
  user: AppUser,
  draftData: {
    title: string;
    content: string;
    pinnedThoughts: string[];
    seconds: number;
    wpm: number;
    wordCount: number;
    initialWordCount?: number | undefined;
    sessionStartTime?: number | undefined;
    activeSessionId: string | null;
    status: string;
  },
  // Шаг 5 DW-4: эпоха текста — её приносит писатель (та же величина, что и у
  // владельца: снимается в момент правки), и она едет в строке. Мутатор сверяет
  // запись с этой отметкой, а не с текущей эпохой на момент записи: опоздавший
  // писатель обязан быть отвергнут, а не «успеть первым».
  epoch?: number | undefined
): LocalDraft {
  const contentState = useContentStore.getState();
  const timerState = useTimerStore.getState();
  const metaState = useSessionMetaStore.getState();
  return {
    userId: user.uid,
    ...draftData,
    // DW4-4: владелец текста назван зеркалом редактора — не «кто сейчас вошёл»,
    // а «чей текст стоит». В окне смены аккаунта (DW-F-3) это разные люди, и
    // запись в адрес вошедшего мутатор ОТВЕРГАЕТ ('owner-mismatch') — текст
    // прежнего владельца уходит в его адрес отдельным писателем-спасением (I3).
    owner: getEditorTextOwner() ?? user.uid,
    ...(epoch !== undefined ? { epoch } : {}),
    sessionStartTime: draftData.sessionStartTime ?? null,
    accumulatedDuration: timerState.accumulatedDuration,
    totalPauseSeconds: timerState.totalPauseSeconds,
    savedDocumentId: metaState.savedDocumentId,
    tags: contentState.tags,
    labelId: contentState.labelId,
    updatedAt: Date.now(),
  } as LocalDraft;
}

export interface DraftPersistResult {
  localOk: boolean;
  remoteOk: boolean;
  localSkipped?: boolean;
  /** Шаг 5: итог отказа мутатора — `'stale-epoch'` означает «текст закрыт
   *  сохранением или сбросом», и повтор такой записи не имеет смысла. */
  localSkipOutcome?: ApplyWriteOutcome | undefined;
  remoteSkipped?: boolean;
  remoteError?: unknown;
}

export async function persistDraft(
  draft: LocalDraft,
  // DY10-10: поколение черновика обязан назвать вызывающий. Прежняя подстановка
  // текущего (`options.generation ?? getDraftGeneration(...)`) делала защиту
  // поколения декоративной: любая отсроченная запись проходила с тем поколением,
  // которое к моменту записи уже подняло сохранение заметки.
  // Шаг 5 DW-4: эпоха живёт в самой записи (`buildLocalDraft`), и писатель
  // вправе её не называть только если принёс строку без неё.
  options: { generation?: number | undefined; remote?: boolean }
): Promise<DraftPersistResult> {
  const usageKB = getLocalStorageUsageKB();
  if (usageKB > 4500) {
    logger.warn('draftPersistence', `localStorage usage: ${usageKB.toFixed(0)}KB — approaching limit`);
  }

  const generation = options.generation;

  const shouldRemoteSave = options.remote ?? true;
  const promises: [Promise<unknown>, Promise<unknown>] = [
    WritingDraftService.saveToLocal(draft, generation),
    shouldRemoteSave
      ? WritingDraftService.saveDraftToCloud(draft, generation)
      : Promise.resolve(true),
  ];

  const [localResult, remoteResult] = await Promise.allSettled(promises);

  // D-1: отказ записи броском — не «пропуск»: `localOk` ложится, «Сохранено» не
  // показывается, текст остаётся на экране. Отказ мутатора по правилу эпохи —
  // наоборот, штатный итог: `localOk` истинен, но записи не было (`localSkipped`).
  const localOk = localResult.status === 'fulfilled';
  const localOutcome = localOk ? localResult.value as ApplyWriteOutcome : undefined;
  const localSkipped = localOk && localOutcome !== 'written';
  const remoteOk = !shouldRemoteSave || (remoteResult.status === 'fulfilled' && remoteResult.value === true);
  const remoteError = remoteResult.status === 'rejected' ? remoteResult.reason : undefined;

  if (localOk) {
    await WritingDraftService.clearLegacyDraft(draft.userId);
  }

  if (!localOk) {
    logger.error('draftPersistence', 'Local save failed', { reason: String(localResult.reason) });
  }
  if (shouldRemoteSave && !remoteOk) {
    const err = remoteError as { code?: unknown; status?: unknown; message?: unknown } | undefined;
    const code = typeof err?.code === 'string' ? err.code : typeof err?.code === 'number' ? String(err.code) : undefined;
    const status = typeof err?.status === 'string' ? err.status : typeof err?.status === 'number' ? String(err.status) : undefined;
    const msg = typeof err?.message === 'string' ? err.message : String(remoteError || 'Did not write');
    const isPermanent = code === '23514' || status === '400' || msg.includes('check constraint') || msg.includes('23514');

    if (isPermanent) {
      logger.error('draftPersistence', 'Cloud save permanently refused by constraint/validation', { reason: msg, code, status });
    } else {
      logger.warn('draftPersistence', 'Cloud save failed (will retry on next change)', { reason: msg });
    }
  }

  return { localOk, localSkipped, localSkipOutcome: localOutcome, remoteOk, remoteError };
}
