import { onCall } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import * as logger from "firebase-functions/logger";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const editWithAI = onCall(async (request) => {
  if (!request.auth) {
    throw new Error("unauthenticated");
  }

  const { content, action } = request.data;
  
  if (typeof content !== 'string' || content.length > 50000) {
    throw new Error("invalid-argument");
  }

  const allowedActions = ['shorten', 'accents', 'ideas'];
  if (!allowedActions.includes(action)) {
    throw new Error("invalid-argument");
  }
  
  const prompts = {
    shorten: "Shorten this text while keeping the main message. Return only the shortened text.",
    accents: "Add accents and stylistic improvements to this text to make it more engaging. Return only the improved text.",
    ideas: "Based on this text, suggest 3 ideas for continuing or expanding it. Return only the ideas as a bulleted list."
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `${prompts[action as keyof typeof prompts]}\n\nText: ${content}`,
    });
    return { text: response.text };
  } catch (error) {
    logger.error("AI Error:", error);
    throw new Error("internal");
  }
});
