import { onCall } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import * as logger from "firebase-functions/logger";
import { z } from "zod";
import { unauthenticated, badInput } from "../shared/errors";
import { sessionContentSchema } from "../shared/validators";
import { reportError } from "../shared/errors";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const editSchema = z.object({
  content: sessionContentSchema,
  action: z.enum(['extract_insights', 'emotional_mirror'])
});

export const editWithAI = onCall(async (request) => {
  if (!request.auth) {
    throw unauthenticated();
  }

  const result = editSchema.safeParse(request.data);
  
  if (!result.success) {
    throw badInput();
  }

  const { content, action } = result.data;
  
  const prompts = {
    extract_insights: "Analyze this text and extract the 3 most important insights or themes. Return them as a bulleted list.",
    emotional_mirror: "Analyze the emotional tone of this text. Reflect back the primary emotions and the underlying mood in a short, empathetic paragraph."
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `${prompts[action]}\n\nText: ${content}`,
    });
    return { text: response.text };
  } catch (error) {
    logger.error("AI Error:", error);
    reportError(error, { action, contentLength: content.length }, 'error');
    throw new Error("The AI service is currently unavailable.");
  }
});
