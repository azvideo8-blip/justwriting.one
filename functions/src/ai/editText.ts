import { onCall, HttpsError } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import * as logger from "firebase-functions/logger";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const editWithAI = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated to use AI features.");
  }

  if (!request.data || typeof request.data !== 'object') {
    throw new HttpsError("invalid-argument", "Missing or invalid payload.");
  }

  const { content, action } = request.data;
  
  if (typeof content !== 'string' || content.length === 0 || content.length > 50000) {
    throw new HttpsError("invalid-argument", "Content exceeds limit or is invalid");
  }

  const allowedActions = ['extract_insights', 'emotional_mirror'];
  if (!allowedActions.includes(action)) {
    throw new HttpsError("invalid-argument", "Action must be one of the allowed predefined strings.");
  }
  
  const prompts = {
    extract_insights: "Analyze this text and extract the 3 most important insights or themes. Return them as a bulleted list.",
    emotional_mirror: "Analyze the emotional tone of this text. Reflect back the primary emotions and the underlying mood in a short, empathetic paragraph."
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `${prompts[action as keyof typeof prompts]}\n\nText: ${content}`,
    });
    return { text: response.text };
  } catch (error) {
    logger.error("AI Error:", error);
    throw new HttpsError("internal", "The AI service is currently unavailable.");
  }
});
