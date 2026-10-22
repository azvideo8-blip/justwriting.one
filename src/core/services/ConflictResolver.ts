import { toDate } from '../utils/dateUtils';
import { LocalStorageService } from './LocalStorageService';
import { requeueDocumentTask } from '../sync/requeueDocumentTask';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb } from '../storage/localDb';
import { reportError } from '../../shared/errors/reportError';
import { SaveDocumentData } from './storageTypes';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';
import { maybeDecrypt, DecryptionError } from '../crypto/cryptoHelpers';
import { VersionService } from './VersionService';
import { comparableOrUnknown } from '../sync/comparableOrUnknown';
import { truncateText } from '../../shared/utils/textLimits';

export const ConflictResolver = {
  async resolveConflict(
    userId: string,
    documentId: string,
    linkedCloudId: string,
    data: SaveDocumentData,
    newVersion: number,
    cloudDoc: { currentVersion: number; totalWords?: number; totalDuration?: number; trashedAt?: unknown },
    originalFirstSessionAt?: number
  ): Promise<{ forked: boolean; forkTitle?: string }> {
    // AUDIT-MH3: дата без времени делала одноимённые форки одного дня
    // неразличимыми; превью контента помогает узнать свою заметку.
    const lang = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEYS.APP_LANGUAGE) === 'en' ? 'en' : 'ru';
    const hhmm = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const preview = truncateText(data.content || '', 30).replace(/\s+/g, ' ').trim();
    const conflictWord = lang === 'ru' ? 'конфликт' : 'conflict';
    const untitledWord = lang === 'ru' ? 'Без названия' : 'Untitled';
    const dateStr = new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US');
    const conflictTitle = `${data.title || untitledWord} (${conflictWord}, ${dateStr} ${hhmm}: ${preview}…)`;
    const forkedDocId = await LocalStorageService.createDocument(userId, {
      title: conflictTitle,
      tags: data.tags,
      labelId: data.labelId,
      firstSessionAt: originalFirstSessionAt ?? data.sessionStartedAt.getTime(),
      lastSessionAt: Date.now(),
    });
    // Decrypt cloud versions upfront so that:
    // 1) Pass 1 knows which cloud versions are actually readable (so unreadable versions aren't skipped from the fork).
    // 2) Pass 2 can reconcile original versions safely without deleting unreadable versions.
    type DecryptedCloudVersion = {
      version: number;
      content?: string | undefined;
      _decryptionError?: boolean | undefined;
      _degraded?: boolean | undefined;
      wordCount: number;
      duration: number;
      wpm: number;
      sessionStartedAt?: Date | undefined;
      savedAt?: Date | undefined;
      mood?: string | undefined;
    };
    let decryptedCloudVersions: DecryptedCloudVersion[] = [];
    // EA-3: исход обоих шагов — Pass 2 удаляет версии из оригинала и имеет на это
    // право, только если облако прочитано и все расходящиеся версии уже в форке.
    let cloudFetched = false;
    let forkCopied = false;
    let forkVersion = 0;
    try {
      const cloudVersions = await VersionService.getVersions(userId, linkedCloudId);
      for (const cv of cloudVersions) {
        let plain: Record<string, unknown>;
        try {
          plain = await maybeDecrypt(cv as unknown as Record<string, unknown>, ['content', 'mood'], []);
        } catch (decErr) {
          if (!(decErr instanceof DecryptionError)) throw decErr;
          reportError(decErr, { action: 'resolveConflict_decrypt', linkedCloudId, version: cv.version });
          decryptedCloudVersions.push({
            version: cv.version,
            content: undefined,
            _decryptionError: true,
            wordCount: cv.wordCount,
            duration: cv.duration,
            wpm: cv.wpm,
            sessionStartedAt: cv.sessionStartedAt ? new Date(cv.sessionStartedAt) : undefined,
            savedAt: cv.savedAt ? new Date(cv.savedAt) : undefined,
            mood: cv.mood ?? undefined,
          });
          continue;
        }
        // DE-1: строка, не прошедшая схему (_degraded), или не-строковый текст —
        // «неизвестно», а не пустая версия: иначе сверка ниже сносит локальную
        // правку и кладёт на её место ''.
        decryptedCloudVersions.push({
          version: cv.version,
          content: typeof plain.content === 'string' ? plain.content : undefined,
          ...(cv._degraded ? { _degraded: true } : {}),
          wordCount: cv.wordCount,
          duration: cv.duration,
          wpm: cv.wpm,
          sessionStartedAt: cv.sessionStartedAt ? new Date(cv.sessionStartedAt) : undefined,
          savedAt: cv.savedAt ? new Date(cv.savedAt) : undefined,
          mood: typeof plain.mood === 'string' ? plain.mood : (cv.mood ?? undefined),
        });
      }
      cloudFetched = true;
    } catch (fetchErr) {
      reportError(fetchErr, { action: 'resolveConflict_fetchCloudVersions', linkedCloudId });
    }

    // AUDIT-MH3: в форк должны попасть ВСЕ несинхронизированные локальные
    // версии (те, которых нет в облаке), а не только последняя правка.
    // CHOKE-1: версия, у которой облачная копия нечитаема (_decryptionError),
    // НЕ считается «уже в облаке» — её локальный plaintext копируется в форк!
    try {
      const localVersions = await LocalVersionService.getVersions(documentId, userId);
      const readableCloudContent = new Map(
        decryptedCloudVersions.filter(v => !v._decryptionError).map(v => [v.version, v.content])
      );
      // N2-6: форк нумеруется заново, 1..k по порядку исходных номеров. Раньше
      // правка была v1, а копии сохраняли свои старые номера (3, 4…) при
      // currentVersion = 1: следующее сохранение брало занятый номер — два текста
      // под одним номером, один из них в облако не попадал. Правка, которой ещё
      // нет среди локальных версий (конфликт при сохранении), ложится последней.
      const toCopy = localVersions
        .filter(v => readableCloudContent.get(v.version) !== v.content) // EA-3: в облаке с тем же текстом — не копируем
        .sort((a, b) => a.version - b.version);
      for (const v of toCopy) {
        await LocalVersionService.addVersion(userId, forkedDocId, {
          content: v.content,
          previousContent: '',
          wordCount: v.wordCount,
          duration: v.duration,
          wpm: v.wpm,
          versionNumber: ++forkVersion,
          goalWords: v.goalWords,
          goalTime: v.goalTime,
          goalReached: v.goalReached,
          sessionStartedAt: new Date(v.sessionStartedAt),
          savedAt: v.savedAt ? new Date(v.savedAt) : undefined,
          mood: v.mood,
        });
      }
      if (!toCopy.some(v => v.content === data.content)) {
        await LocalVersionService.addVersion(userId, forkedDocId, {
          content: data.content,
          previousContent: '',
          wordCount: data.wordCount,
          duration: data.duration,
          wpm: data.wpm,
          versionNumber: ++forkVersion,
          sessionStartedAt: data.sessionStartedAt,
          mood: data.mood,
        });
      }
      forkCopied = true;
    } catch (copyErr) {
      reportError(copyErr, { action: 'resolveConflict_copyUnsynced', documentId });
      // Текущая правка — главное, что должно оказаться в форке: кладём её и при
      // неудачном копировании старых версий (оригинал в этом случае не трогается).
      const inFork = await LocalVersionService.getVersions(forkedDocId, userId).catch(() => []);
      forkVersion = Math.max(0, ...inFork.map(v => v.version));
      if (!inFork.some(v => v.content === data.content)) {
        try {
          await LocalVersionService.addVersion(userId, forkedDocId, {
            content: data.content, previousContent: '', wordCount: data.wordCount, duration: data.duration,
            wpm: data.wpm, versionNumber: forkVersion + 1, sessionStartedAt: data.sessionStartedAt, mood: data.mood,
          });
          forkVersion++;
        } catch (headErr) {
          reportError(headErr, { action: 'resolveConflict_forkHead', documentId });
        }
      }
    }
    // Последняя версия форка — текущая правка (N2-6).
    const forkHead = Math.max(1, forkVersion);
    // R4-2: wordCount/duration — дельта этой сессии; итог заметки лежит в
    // documentWordCount/documentDuration (как во всех остальных путях записи).
    await LocalStorageService.updateAfterSession(forkedDocId, {
      totalWords: data.documentWordCount ?? data.wordCount,
      totalDuration: data.documentDuration ?? data.duration,
      currentVersion: forkHead,
      mood: data.mood,
    }, userId);

    // Bring the ORIGINAL local document in line with the cloud so it doesn't stay stuck in conflict.
    // EA-3: без прочитанного облака или неполного форка оригинал не трогаем —
    // конфликт разрешится при следующей попытке, версии останутся на месте.
    if (!cloudFetched || !forkCopied) {
      reportError(new Error('Conflict fork incomplete: original left untouched'), { action: 'resolveConflict_skipReconcile', documentId, cloudFetched, forkCopied }, 'warning');
    } else try {
      const cloudVerMap = new Map(decryptedCloudVersions.map(v => [v.version, v]));
      const localVersions = await LocalVersionService.getVersions(documentId, userId);

      // Clean up any divergent local versions from original doc (they live safely in the fork now)
      // CHOKE-1: Удаляем локальную версию ТОЛЬКО если сравнение точно говорит
      // { comparable: true, same: false }. Неизвестность (нечитаемая облачная
      // версия, ошибка расшифровки) не должна приводить к удалению.
      const db = await getLocalDb(userId);
      const tx = db.transaction('versions', 'readwrite');
      for (const lv of localVersions) {
        const cv = cloudVerMap.get(lv.version);
        if (!cv) {
          // NARROW-1: В облаке такой версии нет вообще — она никогда не синкалась,
          // Pass 1 уже положил её в форк. В оригинале ей делать нечего.
          await tx.store.delete(lv.id);
          continue;
        }
        /*gate:clock-rule*/
        // Участок правила: решение «эта локальная версия расходится с облаком».
        // Часы устройства здесь запрещены (гейт S0-6): сравнение должно быть по
        // содержимому, а не по времени прибора.
        const comparison = comparableOrUnknown(
          { content: cv.content, _decryptionError: cv._decryptionError, _degraded: cv._degraded },
          { content: lv.content },
        );
        if (comparison.comparable && !comparison.same) {
        /*endgate:clock-rule*/
          await tx.store.delete(lv.id);
        }
      }
      await tx.done;

      const remainingLocalVersions = await LocalVersionService.getVersions(documentId, userId);
      const remainingVerNums = new Set(remainingLocalVersions.map(v => v.version));

      for (const cv of decryptedCloudVersions) {
        if (remainingVerNums.has(cv.version)) continue;
        if (cv._decryptionError || cv._degraded || cv.content === undefined) continue;

        await LocalVersionService.addVersion(userId, documentId, {
          content: cv.content,
          previousContent: '',
          wordCount: cv.wordCount,
          duration: cv.duration,
          wpm: cv.wpm,
          versionNumber: cv.version,
          sessionStartedAt: cv.sessionStartedAt ? new Date(cv.sessionStartedAt) : new Date(),
          savedAt: cv.savedAt ? new Date(cv.savedAt) : undefined,
          mood: cv.mood,
        });
      }
      const maxCloudVersion = Math.max(cloudDoc.currentVersion, ...decryptedCloudVersions.map(v => v.version), 0);
      await LocalStorageService.updateAfterSession(documentId, {
        totalWords: cloudDoc.totalWords ?? data.documentWordCount ?? data.wordCount,
        totalDuration: cloudDoc.totalDuration ?? data.documentDuration ?? data.duration,
        currentVersion: maxCloudVersion,
        mood: data.mood,
      }, userId);

      try {
        const udb = await getLocalDb(userId);
        const tx = udb.transaction('documents', 'readwrite');
        const fresh = await tx.store.get(documentId);
        if (fresh) {
          // N2-7: оригинал приводится к облаку целиком — и корзина тоже. Иначе
          // заметка, удалённая в корзину на другом устройстве, здесь оставалась
          // живой: сверка после этого уже не видит облако «новее».
          const cloudTrashedMs = toDate(cloudDoc.trashedAt)?.getTime();
          await tx.store.put({
            ...fresh,
            lastSyncedCloudVersion: maxCloudVersion,
            ...(cloudTrashedMs ? { trashedAt: cloudTrashedMs } : {}),
          });
        }
        await tx.done;
      } catch { /* ignore */ }
    } catch (reconcileErr) {
      reportError(reconcileErr, { action: 'resolveConflict_reconcileOriginal', documentId, linkedCloudId });
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('doc-version-saved', { detail: { documentId: forkedDocId } }));
      window.dispatchEvent(new CustomEvent('doc-version-saved', { detail: { documentId } }));
    }

    reportError(new Error('Sync conflict: document forked'), { action: 'syncVersionToCloud_conflict', documentId, linkedCloudId, cloudVersion: cloudDoc.currentVersion, localVersion: newVersion }, 'warning');
    await requeueDocumentTask(forkedDocId, userId);
    return { forked: true, forkTitle: conflictTitle };
  },
};
