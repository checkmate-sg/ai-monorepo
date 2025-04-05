import { Tool } from "./types";
import { createClient } from "@workspace/shared-llm-client";
import { observeOpenAI } from "langfuse";
import { withLangfuseSpan } from "./utils";
import { TranslateTextResult } from "./types";

export interface TranslateTextParams {
  text: string;
  language: string;
}

const configObject = {
  model: "gpt-4o",
  temperature: 0,
};

export const translateTextTool: Tool<TranslateTextParams, TranslateTextResult> =
  {
    definition: {
      type: "function",
      function: {
        name: "translate_text",
        description: "Translates a given text into the specified language.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The text to be translated.",
            },
            language: {
              type: "string",
              description: "The language to translate the text into.",
            },
          },
          required: ["text", "language"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
    execute: withLangfuseSpan<TranslateTextParams, TranslateTextResult>(
      "translate-text",
      async (params, context, span) => {
        const client = await createClient("openai", context.env);

        try {
          if (!params.text) {
            throw new Error("Text is required");
          }
          if (!params.language) {
            throw new Error("Language is required");
          }
          const translatePrompt = await context.langfuse.getPrompt(
            "translation",
            undefined,
            {
              label:
                context.env.ENVIRONMENT === "production"
                  ? "cf-production"
                  : context.env.ENVIRONMENT, //TODO: revert after google version deprecated
              type: "chat",
            }
          );

          const observedClient = observeOpenAI(client, {
            clientInitParams: {
              publicKey: context.env.LANGFUSE_PUBLIC_KEY,
              secretKey: context.env.LANGFUSE_SECRET_KEY,
              baseUrl: context.env.LANGFUSE_HOST,
            },
            langfusePrompt: translatePrompt,
            parent: span, // Set this span as parent
          });
          context.logger.info(params, "Executing translate text tool");

          // Format sources for the prompt

          // Compile the prompt with the report and formatted sources
          const config = translatePrompt.config as typeof configObject;
          const messages = translatePrompt.compile({
            text: params.text,
            language: params.language,
          }) as any[];

          const userContent = params.text;

          messages.push({
            role: "user",
            content: userContent,
          });

          // Make the API call to review the report
          const response = await observedClient.chat.completions.create({
            model: config.model || "gpt-4o",
            temperature: config.temperature || 0.0,
            messages: messages as any[],
          });

          // Parse the result - handle null case
          const content = response.choices[0].message.content;

          if (!content) {
            throw new Error("No content returned from translation");
          }

          return {
            success: true,
            result: {
              language: params.language,
              translatedText: content,
            },
          };
        } catch (error: unknown) {
          // Log the error with proper type handling
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred";

          context.logger.error(
            { error, errorMessage },
            "Error in preprocess inputs tool"
          );

          return {
            success: false,
            error: {
              message: errorMessage,
            },
          };
        }
      }
    ),
  };
