import { LLMProvider } from "../types";

export function getProviderFromModel(model: string): LLMProvider {
  if (model.includes("gpt")) {
    return "openai";
  } else if (model.includes("gemini")) {
    return "vertex-ai";
  } else if (model.includes("llama")) {
    return "groq";
  } else {
    throw new Error(`Unsupported model: ${model}`);
  }
}
