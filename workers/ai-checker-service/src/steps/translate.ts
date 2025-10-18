import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { getTranslationSystemPrompt } from "../prompts/translation";
import { createLogger } from "@workspace/shared-utils";

export interface TranslateOptions {
  text: string;
  targetLanguage?: string;
}

export async function translateText(
  options: TranslateOptions,
  env: Env,
  logger = createLogger("translate-text")
): Promise<string> {
  const { text, targetLanguage = "Chinese" } = options;
  const google = createGoogleGenerativeAI({
    apiKey: env.GEMINI_API_KEY,
  });
  const { object } = await (generateObject as any)({
    model: google("gemini-2.5-flash"),
    system: getTranslationSystemPrompt(targetLanguage),
    messages: [
      {
        role: "user",
        content: text,
      },
    ],
    schema: z.object({
      translation: z
        .string()
        .describe("Translated text in the target language"),
    }),
  });

  return object.translation as string;
}
