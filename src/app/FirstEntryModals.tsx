import React, { useContext, useEffect, Suspense } from 'react';
import { EarlierQuestionOpenContext } from './onboardingQueue';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useEmptyDeviceDetection } from '../core/sync/useEmptyDeviceDetection';
import { OPEN_RESTORE_CLOUD_EVENT } from '../core/sync/restoreCloudEvent';
import { useOtherUserDetection } from '../features/auth/hooks/useOtherUserDetection';
import { OtherUserDataModal } from '../features/auth/components/OtherUserDataModal';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';

const RestoreFromCloudModal = React.lazy(() =>
  import('./modals/RestoreFromCloudModal').then(m => ({ default: m.RestoreFromCloudModal })),
);

/**
 * BR-3 (ревью 25.10): окна первого входа — в один ленивый узел. В AppShell они
 * стояли статическими импортами, и вместе с ними в стартовый кусок попадали
 * `useEmptyDeviceDetection` (чтение локального и облачного списков) и
 * `OtherUserDataModal`; `index-*.js` перешагнул порог 100 000 gzip.
 *
 * Развязка окон по-прежнему по одному: `queued` читается здесь же, а не
 * передаётся сверху, — иначе окно успело бы открыться до вопроса политики.
 * Слушатель «открой окно восстановления» живёт, пока висит `queued`: баннер на
 * главном может нажать на него в любой момент.
 */
export function FirstEntryModals() {
  const { user } = useAuthStatus();
  const { shouldPrompt: shouldPromptEmptyDevice, localCount, cloudCount, dismiss: dismissEmptyDevice } = useEmptyDeviceDetection();
  const [manualRestoreOpen, setManualRestoreOpen] = React.useState(false);
  const { hasOtherData, dismiss: dismissOtherData, clear: clearOtherData } = useOtherUserDetection();
  const queued = useContext(EarlierQuestionOpenContext);

  useEffect(() => {
    const onOpen = () => setManualRestoreOpen(true);
    window.addEventListener(OPEN_RESTORE_CLOUD_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_RESTORE_CLOUD_EVENT, onOpen);
  }, []);

  const cloudOpen = shouldPromptEmptyDevice || manualRestoreOpen;

  return (
    <>
      {cloudOpen && user && !queued && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <RestoreFromCloudModal
              open={cloudOpen}
              onClose={() => {
                dismissEmptyDevice();
                setManualRestoreOpen(false);
              }}
              initialLocalCount={localCount}
              initialCloudCount={cloudCount}
              onRestoreAIData={(uid) =>
                import('../features/ai/services/AIRestoreService').then(m => m.restoreAndReattachAIData(uid))
              }
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {hasOtherData && user && !cloudOpen && !queued && (
        <OtherUserDataModal
          open={hasOtherData}
          onClose={dismissOtherData}
          onClear={clearOtherData}
        />
      )}
    </>
  );
}
