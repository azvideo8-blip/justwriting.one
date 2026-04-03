import { onCall, HttpsError } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import * as logger from "firebase-functions/logger";
import { z } from "zod";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const editSchema = z.object({
  content: z.string().min(1).max(50000),
  action: z.enum(['extract_insights', 'emotional_mirror'])
});

export const editWithAI = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated to use AI features.");
  }

  const result = editSchema.safeParse(request.data);
  
  if (!result.success) {
    throw new HttpsError("invalid-argument", "Missing or invalid payload.");
  }

  const { content, action } = result.data;
  
  const prompts = {
    extract_insights: "Analyze this text and extract the 3 most important insights or themes. Return them as a bulleted list.",
    emotional_mirror: "Analyze the emotional tone of this text. Reflect back the primary emotions and the underlying mood in a short, empathetic paragraph."
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `${prompts[action]}\n\nText: ${content}`,
    });
    return { text: response.text };
  } catch (error) {
    logger.error("AI Error:", error);
    throw new HttpsError("internal", "The AI service is currently unavailable.");
  }
});
