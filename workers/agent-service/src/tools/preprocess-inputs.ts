import { Tool, PreprocessResult } from "./types";
import { createClient } from "@workspace/shared-llm-client";
import { observeOpenAI } from "langfuse";
import { withLangfuseSpan, getOpenAIContent } from "./utils";
import { AgentRequest } from "@workspace/shared-types";
import urlRegexSafe from "url-regex-safe";
import normalizeUrl from "normalize-url";
import { extractImageUrlsTool } from "./extract-image-urls";

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
          links: {
            type: "array",
            description: "Array of link objects with details about each link.",
            items: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "The URL of the link",
                },
                reasoning: {
                  type: "string",
                  description: "Why you think it is crucial or not",
                },
                is_crucial: {
                  type: "boolean",
                  description:
                    "Whether the link is crucial to checking the message",
                },
                is_video: {
                  type: "boolean",
                  description: "Whether the link contains a video",
                },
                is_access_blocked: {
                  type: "boolean",
                  description:
                    "Whether access to the link is blocked, or the contents are otherwise unavailable",
                },
              },
              required: [
                "url",
                "reasoning",
                "is_crucial",
                "is_video",
                "is_access_blocked",
              ],
              additionalProperties: false,
            },
          },
          reasoning: {
            type: "string",
            description:
              "The reasoning behind the intent you inferred from the message.",
          },
          intent: {
            type: "string",
            description:
              "What the user's intent is, e.g. to check whether this is a scam, to check if this is really from the government, to check the facts in this article, etc.",
          },
        },
        required: ["links", "reasoning", "intent"],
        additionalProperties: false,
      },
    },
  },
};

export const preprocessInputsTool: Tool<AgentRequest, PreprocessResult> = {
  definition: {
    type: "function",
    function: {
      name: "preprocess_inputs",
      description: "Preprocesses the inputs to be used in the report.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: ["string", "null"],
            description: "The text of the message to be checked.",
          },
          imageUrl: {
            type: ["string", "null"],
            description: "The URL of the image to be checked",
          },
          caption: {
            type: ["string", "null"],
            description: "The caption that accompanies the image to be checked",
          },
        },
        required: ["imageUrl", "text", "caption"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  execute: withLangfuseSpan<AgentRequest, PreprocessResult>(
    "preprocess-inputs",
    async (params, context, span) => {
      const client = await createClient("openai", context.env);

      try {
        let userContent: any[];
        let urls: string[];
        if (params.text) {
          userContent = [
            {
              type: "text",
              text: `User sent in: ${params.text}`,
            },
          ];
          const extractedUrls = params.text.match(urlRegexSafe()) || [];
          urls = extractedUrls.map((url) =>
            normalizeUrl(url, { defaultProtocol: "https", stripWWW: false })
          );
        } else if (params.imageUrl) {
          const captionSuffix = params.caption
            ? `this caption: ${params.caption}`
            : "no caption";
          const extractionResults = await extractImageUrlsTool.execute(
            {
              url: params.imageUrl,
            },
            context
          );
          if (extractionResults.success) {
            const extractedUrls = extractionResults.result.imageUrls;
            urls = extractedUrls.map((url) =>
              normalizeUrl(url, { defaultProtocol: "https", stripWWW: false })
            );
          } else {
            context.logger.error(
              { error: extractionResults.error },
              "Error in extractImageUrlsTool"
            );
            urls = [];
          }
          userContent = [
            {
              type: "text",
              text: `User sent in the following image with ${captionSuffix}`,
            },
            {
              type: "image_url",
              image_url: {
                url: params.imageUrl,
              },
            },
          ];
          //TODO LATER: get URLs from image
        } else {
          throw new Error("No text or image_url provided");
        }

        //get screenshot from URLs
        const screenshots = await Promise.all(
          urls.map(async (url) => {
            const screenshotSpan = span.span({
              name: "screenshot",
              input: { url },
            });
            try {
              const result = await context.env.SCREENSHOT_SERVICE.screenshot({
                url,
                id: context.getId(),
              });
              screenshotSpan.end({
                output: result,
                metadata: { success: true },
              });
              return {
                ...result,
                url,
              };
            } catch (error) {
              const returnError = {
                success: false,
                error: {
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              };
              screenshotSpan.end({
                metadata: returnError,
              });
              return returnError;
            }
          })
        );

        //get openAI-formatted content for screenshots
        const screenshotContent = getOpenAIContent(screenshots);

        //extend userContent with screenshotContent
        userContent = [...userContent, ...screenshotContent];

        const preprocessPrompt = await context.langfuse.getPrompt(
          "preprocess_inputs",
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
          langfusePrompt: preprocessPrompt,
          parent: span, // Set this span as parent
        });
        context.logger.info(params, "Executing preprocess inputs tool");

        // Format sources for the prompt

        // Compile the prompt with the report and formatted sources
        const config = preprocessPrompt.config as typeof configObject;
        const messages = preprocessPrompt.compile() as any[];

        messages.push({
          role: "user",
          content: userContent,
        });

        // Make the API call to review the report
        const response = await observedClient.chat.completions.create({
          model: config.model || "gpt-4o",
          temperature: config.temperature || 0.0,
          seed: config.seed || 11,
          messages: messages as any[],
          response_format: config.response_format,
        });

        // Parse the result - handle null case
        const content = response.choices[0].message.content || "{}";
        const result = JSON.parse(content);

        //loop through result.links and check if any of them are blocked
        let isAccessBlocked = false;
        let isVideo = false;

        if (result.links && Array.isArray(result.links)) {
          for (const link of result.links) {
            if (link.is_access_blocked && link.is_crucial) {
              isAccessBlocked = true;
            }
            if (link.is_video && link.is_crucial) {
              isVideo = true;
            }
          }
        }

        return {
          success: true,
          result: {
            ...result,
            isAccessBlocked,
            isVideo,
            startingContent: userContent,
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
