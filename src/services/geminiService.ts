import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function editWithAI(content: string, action: 'shorten' | 'accents' | 'ideas') {
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
    return response.text;
  } catch (error) {
    console.error("AI Error:", error);
    return "Error generating AI response.";
  }
}
