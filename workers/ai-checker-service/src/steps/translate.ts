import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { getTranslationSystemPrompt } from "../prompts/translation";
import { createLogger } from "@workspace/shared-utils";
import { CheckContext } from "../types";

export interface TranslateInputs {
  text: string;
  targetLanguage?: string;
}

export async function translateText(
  options: TranslateInputs,
  checkCtx: CheckContext
): Promise<string> {
  const { text, targetLanguage = "Chinese" } = options;
  const env = checkCtx.env;

  try {
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
      maxRetries: 2,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "translate-text",
        metadata: {
          langfuseTraceId: checkCtx.trace?.id ?? "",
          langfuseUpdateParent: false,
        },
      },
    });

    return object.translation as string;
  } catch (error) {
    checkCtx.logger.error({ error }, "Error during translation");

    // Return error message in target language
    const errorMessages: Record<string, string> = {
      Chinese: "翻译时发生错误",
      Malay: "Ralat berlaku semasa penterjemahan",
      "Bahasa Melayu": "Ralat berlaku semasa penterjemahan",
      "Bahasa Indonesia": "Terjadi kesalahan saat penerjemahan",
      Tamil: "மொழிபெயர்ப்பின் போது பிழை ஏற்பட்டது",
    };

    return (
      errorMessages[targetLanguage] || "An error occurred during translation"
    );
  }
}
