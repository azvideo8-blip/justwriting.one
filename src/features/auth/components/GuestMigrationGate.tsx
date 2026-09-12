import { useState, useEffect, useRef } from 'react';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { MigrationPrompt, checkGuestDocuments } from './MigrationPrompt';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

export function GuestMigrationGate() {
  const { user, isGuest } = useAuthStatus();
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [migrationUserId, setMigrationUserId] = useState<string | null>(null);
  const [migrationDocCount, setMigrationDocCount] = useState(0);
  const lastCheckedUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user || isGuest) {
      // No setState here (react-hooks/set-state-in-effect): the render below
      // already hides the prompt while signed out, and the uid check keeps a
      // stale prompt from a previous account off the screen.
      lastCheckedUidRef.current = null;
      return;
    }

    if (lastCheckedUidRef.current === user.uid) {
      return;
    }
    // «Оставить локальными» once means once. Before the gate existed the prompt
    // appeared only at sign-in; without this flag it would return on every load
    // until the guest notes are moved or deleted.
    if (localStorage.getItem(STORAGE_KEYS.MIGRATION_DECLINED(user.uid)) === '1') {
      lastCheckedUidRef.current = user.uid;
      return;
    }

    lastCheckedUidRef.current = user.uid;
    let active = true;

    void checkGuestDocuments().then((result) => {
      if (!active) return;
      if (result) {
        const count = result.docs.length + (result.hasDraft ? 1 : 0);
        if (count > 0) {
          setMigrationUserId(user.uid);
          setMigrationDocCount(count);
        }
      }
    });

    return () => {
      active = false;
    };
  }, [user, isGuest]);

  if (!user || isGuest || !migrationUserId || migrationUserId !== user.uid || migrationDocCount <= 0) {
    return null;
  }

  return (
    <MigrationPrompt
      userId={migrationUserId}
      docCount={migrationDocCount}
      onDone={(migrated) => {
        const count = migrationDocCount;
        setMigrationUserId(null);
        setMigrationDocCount(0);
        if (migrated) {
          showToast(t('migration_success_local', { count }), 'success');
        } else {
          try { localStorage.setItem(STORAGE_KEYS.MIGRATION_DECLINED(migrationUserId), '1'); } catch { /* private mode */ }
        }
      }}
      onCloudSynced={(synced) => showToast(t('migration_synced_cloud', { count: synced }), 'success')}
    />
  );
}
