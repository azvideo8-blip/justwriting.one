export function parseAiResponse(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new Error('Invalid AI response format');
  }

  const res = response as { text?: string };
  const text = res.text;
  
  if (typeof text !== 'string') {
    throw new Error('AI response missing text field');
  }

  // Clean up potential markdown formatting anomalies from Gemini
  // e.g., if it wraps the response in ```markdown ... ```
  let cleanText = text.trim();
  if (cleanText.startsWith('```') && cleanText.endsWith('```')) {
    const lines = cleanText.split('\n');
    if (lines.length > 2) {
      cleanText = lines.slice(1, -1).join('\n').trim();
    }
  }

  return cleanText;
}
