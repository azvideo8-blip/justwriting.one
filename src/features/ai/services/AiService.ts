import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../../../core/firebase/client";
import { mapFirebaseError } from "../../../core/errors/errorHandler";

const functions = getFunctions(app);
const editWithAIFunction = httpsCallable(functions, 'editWithAI');

export async function editWithAI(content: string, action: 'shorten' | 'accents' | 'ideas') {
  try {
    const result = await editWithAIFunction({ content, action });
    return (result.data as { text: string }).text;
  } catch (error) {
    console.error("AI Error:", error);
    throw new Error(mapFirebaseError({ code: 'AI Error' }));
  }
}
