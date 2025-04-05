import { Tool } from "./types";
import { createClient } from "@workspace/shared-llm-client";
import { observeOpenAI } from "langfuse";
import { withLangfuseSpan } from "./utils";
import { ExtractImageUrlsResult } from "./types";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface ExtractImageUrlsParams {
  url: string;
}

const configObject = {
  model: "gpt-4o-mini",
  temperature: 0,
  seed: 11,
  response_format: {
    type: "json_schema" as const,
    json_schema: {
      name: "extract_image_urls",
      schema: {
        type: "object",
        properties: {
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri",
              description: "A valid URL starting with http or https.",
            },
            description: "Array of image URLs extracted from the content",
          },
        },
        required: ["image_urls"],
        additionalProperties: false,
      },
    },
  },
};

export const extractImageUrlsTool: Tool<
  ExtractImageUrlsParams,
  ExtractImageUrlsResult
> = {
  definition: {
    type: "function",
    function: {
      name: "extract_image_urls",
      description: "Extracts all image URLs from the provided content.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to extract image URLs from.",
          },
        },
        required: ["content"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  execute: withLangfuseSpan<ExtractImageUrlsParams, ExtractImageUrlsResult>(
    "extract-image-urls",
    async (params, context, span) => {
      const client = await createClient("openai", context.env);

      try {
        if (!params.url) {
          throw new Error("URL is required");
        }
        const extractUrlsPrompt = await context.langfuse.getPrompt(
          "extract_urls_from_image",
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
          langfusePrompt: extractUrlsPrompt,
          parent: span,
        });
        context.logger.info(params, "Executing extract image URLs tool");

        const config = extractUrlsPrompt.config as typeof configObject;
        const messages =
          extractUrlsPrompt.compile() as ChatCompletionMessageParam[];

        messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract all image URLs from the following image`,
            },
            {
              type: "image_url",
              image_url: {
                url: params.url,
              },
            },
          ],
        });

        // Make the API call to extract image URLs
        const response = await observedClient.chat.completions.create({
          model: config.model || "gpt-4o",
          temperature: config.temperature || 0.0,
          seed: config.seed || 11,
          response_format: config.response_format,
          messages: messages as any[],
        });

        // Parse the result
        const content = response.choices[0].message.content || "{}";
        const result = JSON.parse(content);

        if (result.image_urls) {
          context.logger.info(
            { result },
            "Extracted image URLs from the provided content"
          );
          return {
            success: true,
            result: {
              imageUrls: result.image_urls,
            },
          };
        } else {
          throw new Error("No image URLs returned from extraction");
        }
      } catch (error: unknown) {
        // Log the error with proper type handling
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

        context.logger.error(
          { error, errorMessage },
          "Error in extract image URLs tool"
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
