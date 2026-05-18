import { motion, AnimatePresence } from 'motion/react';
import { HardDrive } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { getOrCreateGuestId, getLocalDb } from '../../../shared/lib/localDb';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { SyncService } from '../../writing/services/SyncService';

async function migrateDocuments(userId: string): Promise<number> {
  const guestId = getOrCreateGuestId();
  const db = await getLocalDb();
  const tx = db.transaction(['documents', 'versions'], 'readwrite');
  const docStore = tx.objectStore('documents');
  const verStore = tx.objectStore('versions');

  const guestDocs = await docStore.index('by-guest').getAll(guestId);
  if (guestDocs.length === 0) { await tx.done; return 0; }

  const verIndex = verStore.index('by-document');
  const versionPuts: Promise<string>[] = [];
  for (const doc of guestDocs) {
    let cursor = await verIndex.openCursor(doc.id);
    while (cursor) {
      if (cursor.value.guestId === guestId) {
        versionPuts.push(verStore.put({ ...cursor.value, guestId: userId }));
      }
      cursor = await cursor.continue();
    }
  }

  await Promise.all([
    ...guestDocs.map(doc => docStore.put({ ...doc, guestId: userId })),
    ...versionPuts,
    tx.done,
  ]);

  return guestDocs.length;
}

interface MigrationPromptProps {
  userId: string;
  docCount: number;
  onDone: () => void;
  onCloudSynced?: (count: number) => void;
}

export function MigrationPrompt({ userId, docCount, onDone, onCloudSynced }: MigrationPromptProps) {
  const { t } = useLanguage();

  const handleMigrate = async () => {
    try {
      const count = await migrateDocuments(userId);
      if (count > 0) {
        try {
          const { synced, failed } = await SyncService.syncAllUnlinked(userId);
          if (synced > 0) onCloudSynced?.(synced);
          if (failed > 0 && import.meta.env.DEV) {
            console.warn(`Migration: ${synced} synced, ${failed} failed`);
          }
        } catch {
          // Cloud sync failed — local migration still succeeded
        }
      }
      onDone();
    } catch (e) {
      console.error('Migration failed:', e);
      onDone();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] bg-surface-base/80 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          data-modal
          initial={{ scale: 0.95, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-sm bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
        >
          <div className="w-10 h-10 rounded-2xl bg-text-main/5 border border-border-subtle flex items-center justify-center mb-4">
            <HardDrive size={18} className="text-text-main/60" />
          </div>

          <h2 className="text-base font-medium text-text-main mb-2">
            {t('migration_found_title')}
          </h2>
          <p className="text-sm text-text-main/50 mb-6">
            {t('migration_found_hint', { count: docCount })}
          </p>

          <div className="flex flex-col gap-2">
            <button
              onClick={handleMigrate}
              className="w-full py-2.5 rounded-xl bg-text-main text-surface-base text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {t('migration_move_to_account')}
            </button>
            <button
              onClick={onDone}
              className="w-full py-2.5 rounded-xl text-text-main/40 text-sm hover:text-text-main/60 transition-colors"
            >
              {t('migration_keep_local')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export async function checkGuestDocuments(): Promise<{ guestId: string; docs: import('../../../shared/lib/localDb').LocalDocument[] } | null> {
  const guestId = getOrCreateGuestId();
  try {
    const localDocs = await LocalDocumentService.getGuestDocuments(guestId);
    if (localDocs.length > 0) return { guestId, docs: localDocs };
  } catch (e) {
    console.error('Failed to check local docs for migration:', e);
  }
  return null;
}
