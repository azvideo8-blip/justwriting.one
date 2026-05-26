import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { setUserRole } from './admin/setUserRole';
export { editWithAI } from './ai/editWithAI';
export { chatWithAI } from './ai/chatWithAI';
export { summarizeDocument } from './ai/summarizeDocument';
export { validateCustomPrompt } from './ai/validateCustomPrompt';
export { getAIUsageStats } from './ai/getAIUsageStats';
