import { LocalStorageService } from './LocalStorageService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb } from '../storage/localDb';
import { reportError } from '../../shared/errors/reportError';
import { SaveDocumentData } from './storageTypes';

export const ConflictResolver = {
  async resolveConflict(
    userId: string,
    documentId: string,
    linkedCloudId: string,
    data: SaveDocumentData,
    newVersion: number,
    cloudDoc: { currentVersion: number; totalWords?: number; totalDuration?: number },
    originalFirstSessionAt?: number
  ): Promise<{ forked: boolean; forkTitle?: string }> {
    // AUDIT-MH3: дата без времени делала одноимённые форки одного дня
    // неразличимыми; превью контента помогает узнать свою заметку.
    const hhmm = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const preview = (data.content || '').slice(0, 30).replace(/\s+/g, ' ').trim();
    const conflictTitle = `${data.title || 'Untitled'} (Conflict ${new Date().toLocaleDateString()} ${hhmm}: ${preview}…)`;
    const forkedDocId = await LocalStorageService.createDocument(userId, {
      title: conflictTitle,
      tags: data.tags,
      labelId: data.labelId,
      firstSessionAt: originalFirstSessionAt ?? data.sessionStartedAt.getTime(),
      lastSessionAt: Date.now(),
    });
    await LocalVersionService.addVersion(userId, forkedDocId, {
      content: data.content,
      previousContent: '',
      wordCount: data.wordCount,
      duration: data.duration,
      wpm: data.wpm,
      versionNumber: 1,
      sessionStartedAt: data.sessionStartedAt,
      mood: data.mood,
    });

    // Decrypt cloud versions upfront so that:
    // 1) Pass 1 knows which cloud versions are actually readable (so unreadable versions aren't skipped from the fork).
    // 2) Pass 2 can reconcile original versions safely without deleting unreadable versions.
    type DecryptedCloudVersion = {
      version: number;
      content?: string | undefined;
      _decryptionError?: boolean | undefined;
      wordCount: number;
      duration: number;
      wpm: number;
      sessionStartedAt?: Date | undefined;
      savedAt?: Date | undefined;
      mood?: string | undefined;
    };
    let decryptedCloudVersions: DecryptedCloudVersion[] = [];
    try {
      const { VersionService } = await import('./VersionService');
      const cloudVersions = await VersionService.getVersions(userId, linkedCloudId);
      const { maybeDecrypt, DecryptionError } = await import('../crypto/cryptoHelpers');
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
        decryptedCloudVersions.push({
          version: cv.version,
          content: typeof plain.content === 'string' ? plain.content : '',
          wordCount: cv.wordCount,
          duration: cv.duration,
          wpm: cv.wpm,
          sessionStartedAt: cv.sessionStartedAt ? new Date(cv.sessionStartedAt) : undefined,
          savedAt: cv.savedAt ? new Date(cv.savedAt) : undefined,
          mood: typeof plain.mood === 'string' ? plain.mood : (cv.mood ?? undefined),
        });
      }
    } catch (fetchErr) {
      reportError(fetchErr, { action: 'resolveConflict_fetchCloudVersions', linkedCloudId });
    }

    // AUDIT-MH3: в форк должны попасть ВСЕ несинхронизированные локальные
    // версии (те, которых нет в облаке), а не только последняя правка.
    // CHOKE-1: версия, у которой облачная копия нечитаема (_decryptionError),
    // НЕ считается «уже в облаке» — её локальный plaintext копируется в форк!
    try {
      const localVersions = await LocalVersionService.getVersions(documentId);
      const readableCloudVerNums = new Set(
        decryptedCloudVersions.filter(v => !v._decryptionError).map(v => v.version)
      );
      for (const v of localVersions) {
        if (readableCloudVerNums.has(v.version)) continue;          // уже есть в облаке в читаемом виде
        if (v.content === data.content) continue;           // уже положена как versionNumber: 1
        await LocalVersionService.addVersion(userId, forkedDocId, {
          content: v.content,
          previousContent: '',
          wordCount: v.wordCount,
          duration: v.duration,
          wpm: v.wpm,
          versionNumber: v.version,
          goalWords: v.goalWords,
          goalTime: v.goalTime,
          goalReached: v.goalReached,
          sessionStartedAt: new Date(v.sessionStartedAt),
          savedAt: v.savedAt ? new Date(v.savedAt) : undefined,
          mood: v.mood,
        });
      }
    } catch (copyErr) {
      reportError(copyErr, { action: 'resolveConflict_copyUnsynced', documentId });
    }
    await LocalStorageService.updateAfterSession(forkedDocId, {
      totalWords: data.wordCount,
      totalDuration: data.duration,
      currentVersion: 1,
      mood: data.mood,
    });

    // Bring the ORIGINAL local document in line with the cloud so it doesn't stay stuck in conflict
    try {
      const { comparableOrUnknown } = await import('../sync/comparableOrUnknown');
      const cloudVerMap = new Map(decryptedCloudVersions.map(v => [v.version, v]));
      const localVersions = await LocalVersionService.getVersions(documentId);

      // Clean up any divergent local versions from original doc (they live safely in the fork now)
      // CHOKE-1: Удаляем локальную версию ТОЛЬКО если сравнение точно говорит
      // { comparable: true, same: false }. Неизвестность (нечитаемая облачная
      // версия, ошибка расшифровки) не должна приводить к удалению.
      const db = await getLocalDb();
      const tx = db.transaction('versions', 'readwrite');
      for (const lv of localVersions) {
        const cv = cloudVerMap.get(lv.version);
        const comparison = comparableOrUnknown(
          cv ? { content: cv.content, _decryptionError: cv._decryptionError } : undefined,
          { content: lv.content },
        );
        if (comparison.comparable && !comparison.same) {
          await tx.store.delete(lv.id);
        }
      }
      await tx.done;

      const remainingLocalVersions = await LocalVersionService.getVersions(documentId);
      const remainingVerNums = new Set(remainingLocalVersions.map(v => v.version));

      for (const cv of decryptedCloudVersions) {
        if (remainingVerNums.has(cv.version)) continue;
        if (cv._decryptionError || cv.content === undefined) continue;

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
        totalWords: cloudDoc.totalWords ?? data.wordCount,
        totalDuration: cloudDoc.totalDuration ?? data.duration,
        currentVersion: maxCloudVersion,
        mood: data.mood,
      });

      try {
        const updatedOrig = await LocalStorageService.getDocument(documentId);
        if (updatedOrig) {
          const udb = await getLocalDb();
          await udb.put('documents', { ...updatedOrig, lastSyncedCloudVersion: maxCloudVersion });
        }
      } catch { /* ignore */ }
    } catch (reconcileErr) {
      reportError(reconcileErr, { action: 'resolveConflict_reconcileOriginal', documentId, linkedCloudId });
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('doc-version-saved', { detail: { documentId: forkedDocId } }));
      window.dispatchEvent(new CustomEvent('doc-version-saved', { detail: { documentId } }));
    }

    reportError(new Error('Sync conflict: document forked'), { action: 'syncVersionToCloud_conflict', documentId, linkedCloudId, cloudVersion: cloudDoc.currentVersion, localVersion: newVersion }, 'warning');
    const syncDb = await getLocalDb();
    await syncDb.put('syncQueue', {
      id: `sync_${forkedDocId}`,
      documentId: forkedDocId,
      type: 'document' as const,
      createdAt: Date.now(),
      ownerId: userId,
    });
    return { forked: true, forkTitle: conflictTitle };
  },
};
