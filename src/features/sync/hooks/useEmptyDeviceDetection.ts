import { useState, useEffect, useCallback } from 'react';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { isVaultUnlocked } from '../../../core/crypto/encrypt';
import { getEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { LocalStorageService } from '../../../core/services/LocalStorageService';
import { DocumentService } from '../../../core/services/DocumentService';

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
      const localDocs = await LocalStorageService.getGuestDocuments(uid);
      const cloudDocs = await DocumentService.getUserDocuments(uid);

      const localLen = localDocs.length;
      const cloudLen = cloudDocs.length;

      setLocalCount(localLen);
      setCloudCount(cloudLen);

      // Detection condition: 0 notes locally while cloud has notes, OR noticeably fewer (< 50% when cloud >= 5)
      const hasZeroLocal = localLen === 0 && cloudLen > 0;
      const hasSignificantlyFewer = cloudLen >= 5 && localLen < cloudLen * 0.5;

      if (hasZeroLocal || hasSignificantlyFewer) {
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
