import { initializeApp } from 'firebase-admin/app';
import { getLangfuse } from './shared/aiUtils';

initializeApp();

process.on('SIGTERM', async () => {
  const lf = getLangfuse();
  if (lf) {
    try { await lf.flushAsync(); } catch (e) { console.error('[shutdown] flush error', e); }
  }
  process.exit(0);
});

export { setUserRole } from './admin/setUserRole';
export { resetUserLimit } from './admin/resetUserLimit';
export { editWithAI } from './ai/editWithAI';
export { chatWithAI } from './ai/chatWithAI';
export { summarizeDocument } from './ai/summarizeDocument';
export { validateCustomPrompt } from './ai/validateCustomPrompt';
export { getAIUsageStats } from './ai/getAIUsageStats';
export { getAILimit } from './ai/getAILimit';
