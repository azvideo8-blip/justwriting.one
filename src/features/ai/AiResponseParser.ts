// src/features/ai/AiResponseParser.ts
export const AiResponseParser = {
  parse(response: { text?: string }) {
    if (!response || !response.text) {
      throw new Error("Invalid AI response: No text content found.");
    }
    const text = response.text.trim();
    if (text.length === 0) {
      throw new Error("Invalid AI response: Empty text content.");
    }
    return text;
  }
};
