// src/features/ai/AiPromptService.ts
export const AiPromptService = {
  constructEditPrompt(content: string, instruction: string) {
    return `
      You are an expert editor. 
      Please edit the following text based on the instruction provided.
      
      Instruction: ${instruction}
      
      Text:
      ${content}
      
      Return only the edited text.
    `;
  }
};
