// src/features/ai/AiClient.ts
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const AiClient = {
  async generateContent(prompt: string, config?: unknown) {
    try {
      return await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config
      });
    } catch (error) {
      console.error("AI Client Error:", error);
      throw error;
    }
  }
};
