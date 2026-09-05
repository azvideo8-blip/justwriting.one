import { useState, useEffect, useCallback } from 'react';
import { useAuthStatus } from '../../app/useAuthStatus';
import { isVaultUnlocked } from '../crypto/encrypt';
import { getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { LocalStorageService } from '../services/LocalStorageService';
import { DocumentService } from '../services/DocumentService';

export function getRestoreDismissedKey(userId: string): string {
  return `jw_restore_prompt_dismissed_${userId}`;
}

export function isRestoreDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(getRestoreDismissedKey(userId)) === 'true';
  } catch {
    return false;
  }
}

export function setRestoreDismissed(userId: string, dismissed = true): void {
  try {
    if (dismissed) {
      localStorage.setItem(getRestoreDismissedKey(userId), 'true');
    } else {
      localStorage.removeItem(getRestoreDismissedKey(userId));
    }
  } catch {
    /* ignore */
  }
}

export interface EmptyDeviceDetectionState {
  shouldPrompt: boolean;
  localCount: number;
  cloudCount: number;
  dismiss: () => void;
  recheck: () => Promise<void>;
}

export function useEmptyDeviceDetection(): EmptyDeviceDetectionState {
  const { user, isGuest } = useAuthStatus();
  const [shouldPrompt, setShouldPrompt] = useState(false);
  const [localCount, setLocalCount] = useState(0);
  const [cloudCount, setCloudCount] = useState(0);

  const check = useCallback(async () => {
    if (!user || isGuest) {
      setShouldPrompt(false);
      return;
    }

    const uid = user.uid;
    if (isRestoreDismissed(uid)) {
      setShouldPrompt(false);
      return;
    }

    // Vault check: wait for vault unlock if encryption enabled
    if (getEncryptionEnabled(uid) && !isVaultUnlocked()) {
      setShouldPrompt(false);
      return;
    }

    try {
      const localDocs = await LocalStorageService.getDocumentsByOwner(uid);
      const cloudDocs = await DocumentService.getUserDocuments(uid);

      const localLen = localDocs.length;
      const cloudLen = cloudDocs.length;

      setLocalCount(localLen);
      setCloudCount(cloudLen);

      // AG-RESTORE-1: Prompt if local device has fewer notes than the cloud
      const isMissingCloudNotes = localLen < cloudLen && cloudLen > 0;

      if (isMissingCloudNotes) {
        setShouldPrompt(true);
      } else {
        setShouldPrompt(false);
      }
    } catch {
      setShouldPrompt(false);
    }
  }, [user, isGuest]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) {
        await check();
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [check]);

  const dismiss = useCallback(() => {
    if (user?.uid) {
      setRestoreDismissed(user.uid, true);
    }
    setShouldPrompt(false);
  }, [user]);

  return {
    shouldPrompt,
    localCount,
    cloudCount,
    dismiss,
    recheck: check,
  };
}
