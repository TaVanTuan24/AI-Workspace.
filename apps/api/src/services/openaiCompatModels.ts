import type { ProviderId } from "@uaiw/shared/types/provider.js";

export const OPENAI_COMPAT_MODELS: Record<string, { provider: ProviderId; displayName: string }> = {
  "gemini-web": {
    provider: "gemini",
    displayName: "Gemini Web"
  },
  "chatgpt-web": {
    provider: "chatgpt",
    displayName: "ChatGPT Web"
  },
  "claude-web": {
    provider: "claude",
    displayName: "Claude Web"
  }
};

export function convertMessagesToPrompt(messages: Array<{ role: string; content: string }>) {
  if (messages.length === 1 && messages[0].role === "user") {
    return messages[0].content;
  }
  let prompt = "";
  for (const m of messages) {
    if (m.role === "system") {
      prompt += `System:\n${m.content}\n\n`;
    } else if (m.role === "user") {
      prompt += `User:\n${m.content}\n\n`;
    } else if (m.role === "assistant") {
      prompt += `Assistant:\n${m.content}\n\n`;
    }
  }
  prompt += "Answer as the assistant.";
  return prompt.trim();
}
