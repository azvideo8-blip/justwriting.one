import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LoginPage } from '../pages/LoginPage';
import { useLoginModal } from '../contexts/LoginModalContext';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { PostLoginMigrationModal } from './PostLoginMigrationModal';
import { MigrationService } from '../../writing/services/MigrationService';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';

export function LoginModalOverlay({ open }: { open: boolean }) {
  const { closeLoginModal } = useLoginModal();
  const { isAuthenticated, user } = useAuthStatus();
  const [showMigration, setShowMigration] = useState(false);
  const [migratingUserId, setMigratingUserId] = useState<string | null>(null);
  const [checkedMigration, setCheckedMigration] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user || checkedMigration) return;
    setCheckedMigration(true);

    const guestId = getOrCreateGuestId();
    MigrationService.hasLocalDocuments(guestId).then(has => {
      if (has) {
        setMigratingUserId(user.uid);
        setShowMigration(true);
        closeLoginModal();
      }
    });
  }, [isAuthenticated, user, checkedMigration, closeLoginModal]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-surface-base/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeLoginModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              <LoginPage isModal onSuccess={closeLoginModal} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMigration && migratingUserId && (
          <PostLoginMigrationModal
            userId={migratingUserId}
            onDone={() => {
              setShowMigration(false);
              setMigratingUserId(null);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
