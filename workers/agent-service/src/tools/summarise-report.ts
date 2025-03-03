import { Tool } from "./types";
import { createClient } from "../client";
import { observeOpenAI } from "langfuse";
import { withLangfuseSpan } from "./utils";
import { SummariseReportResult } from "./types";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface SummariseReportParams {
  report: string;
}

const configObject = {
  model: "gpt-4o",
  temperature: 0,
  seed: 11,
  response_format: {
    type: "json_schema" as const,
    json_schema: {
      name: "summarise_report",
      schema: {
        type: "object",
        properties: {
          community_note: {
            type: "string",
            description:
              "The community note you generated, which should start with a clear statement, followed by a concise elaboration.",
          },
        },
        required: ["community_note"],
        additionalProperties: false,
      },
    },
  },
};

export const summariseReportTool: Tool<
  SummariseReportParams,
  SummariseReportResult
> = {
  definition: {
    type: "function",
    function: {
      name: "summarise_report",
      description:
        "Given a long-form report, and the text or image message the user originally sent in, summarises the report into an X-style community note of around 50-100 words.",
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
  execute: withLangfuseSpan<SummariseReportParams, SummariseReportResult>(
    "summarise-report",
    async (params, context, span) => {
      const client = await createClient("openai", context.env);

      try {
        if (!params.report) {
          throw new Error("Report is required");
        }
        const summarisePrompt = await context.langfuse.getPrompt(
          "summarise_report",
          undefined,
          {
            label: context.env.ENVIRONMENT,
            type: "chat",
          }
        );

        const observedClient = observeOpenAI(client, {
          clientInitParams: {
            publicKey: context.env.LANGFUSE_PUBLIC_KEY,
            secretKey: context.env.LANGFUSE_SECRET_KEY,
            baseUrl: context.env.LANGFUSE_HOST,
          },
          langfusePrompt: summarisePrompt,
          parent: span, // Set this span as parent
        });
        context.logger.info(params, "Executing summarise report tool");

        // Format sources for the prompt

        // Compile the prompt with the report and formatted sources
        const config = summarisePrompt.config as typeof configObject;
        const messages =
          summarisePrompt.compile() as ChatCompletionMessageParam[];
        let userContent: any[];

        if (context.getType() === "text") {
          const text = context.getText();
          if (!text) {
            throw new Error("Text type, but text is missing");
          }
          userContent = [
            {
              type: "text",
              text: `User sent in: ${text}`,
            },
          ];
        } else if (context.getType() === "image") {
          const imageUrl = context.getImageUrl();
          if (!imageUrl) {
            throw new Error("Image type, but imageUrl is missing");
          }
          const caption = context.getCaption();
          const captionSuffix = caption
            ? `this caption: ${caption}`
            : "no caption";
          userContent = [
            {
              type: "text",
              text: `User sent in the following image with ${captionSuffix}`,
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ];
        } else {
          throw new Error("Unknown content type received supported");
        }

        userContent.push({
          type: "text",
          text: `***Report***\n${params.report}\n****End Report***`,
        });

        messages.push({
          role: "user",
          content: userContent,
        });

        // Make the API call to review the report
        const response = await observedClient.chat.completions.create({
          model: config.model || "gpt-4o",
          temperature: config.temperature || 0.0,
          seed: config.seed || 11,
          response_format: config.response_format,
          messages: messages as any[],
        });

        // Parse the result - handle null case
        const content = response.choices[0].message.content || "{}";
        const result = JSON.parse(content);

        if (result.community_note) {
          return {
            success: true,
            result: {
              summary: result.community_note,
            },
          };
        } else {
          throw new Error("No community note returned from summarise report");
        }
      } catch (error: unknown) {
        // Log the error with proper type handling
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

        context.logger.error(
          { error, errorMessage },
          "Error in summarise report tool"
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
