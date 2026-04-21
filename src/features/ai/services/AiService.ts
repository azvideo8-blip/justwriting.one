import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../../../core/firebase/client";
import { parseAiResponse } from "../utils/AiResponseParser";

const functions = getFunctions(app);
const editWithAIFunction = httpsCallable(functions, 'editWithAI');

export type AiAction = 'extract_insights' | 'emotional_mirror';

export async function editWithAI(content: string, action: AiAction) {
  try {
    const result = await editWithAIFunction({ content, action });
    return parseAiResponse(result.data);
  } catch (error: unknown) {
    if (import.meta.env.DEV) {
      console.error("AI Error:", error);
    }
    throw new Error(
      error instanceof Error && error.message
        ? error.message
        : 'AI request failed. Please try again later.'
    );
  }
}
