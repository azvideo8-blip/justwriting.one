import { onCall } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import * as logger from "firebase-functions/logger";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const editWithAI = onCall(async (request) => {
  const { content, action } = request.data;
  
  const prompts = {
    shorten: "Shorten this text while keeping the main message. Return only the shortened text.",
    accents: "Add accents and stylistic improvements to this text to make it more engaging. Return only the improved text.",
    ideas: "Based on this text, suggest 3 ideas for continuing or expanding it. Return only the ideas as a bulleted list."
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `${prompts[action]}\n\nText: ${content}`,
    });
    return { text: response.text };
  } catch (error) {
    logger.error("AI Error:", error);
    throw new Error("Error generating AI response.");
  }
});
