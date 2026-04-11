import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../../../core/firebase/client";
import { parseAiResponse } from "../utils/AiResponseParser";
import { translations } from "../../../core/i18n";

const functions = getFunctions(app);
const editWithAIFunction = httpsCallable(functions, 'editWithAI');

export type AiAction = 'extract_insights' | 'emotional_mirror';

export async function editWithAI(content: string, action: AiAction) {
  try {
    const result = await editWithAIFunction({ content, action });
    return parseAiResponse(result.data);
  } catch (error: unknown) {
    console.error("AI Error:", error);
    
    // Get localized fallback message
    const lang = localStorage.getItem('app_language') || 'en';
    const fallback = translations['ai_resting_error']?.[lang as 'ru' | 'en'] || "AI is currently resting. Please try again later.";
    
    return fallback;
  }
}
