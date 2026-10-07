import { createContext } from 'react';

/**
 * Окна первого входа идут по одному. Политика и вопрос о синхронизации живут в
 * PrivacyGuard (AppProviders), а сейф, загрузка из облака, код восстановления и
 * прочие ворота — в AppShell; без общего сигнала на новом устройстве они
 * всплывали стопкой (аудит диалогов, раунд 2, 2026-10-07). true — открыт вопрос
 * PrivacyGuard, остальным окнам ждать.
 */
export const EarlierQuestionOpenContext = createContext(false);
