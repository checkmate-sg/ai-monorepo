import { Tool, PreprocessResult } from "./types";
import { createClient } from "../client";
import { observeOpenAI, ChatPromptClient } from "langfuse";
import { withLangfuseSpan, getOpenAIContent } from "./utils";
import { AgentRequest, ScreenshotResult } from "@workspace/shared-types";
import urlRegexSafe from "url-regex-safe";

const configObject = {
  model: "gpt-4o",
  temperature: 0.0,
  seed: 11,
  response_format: {
    type: "json_schema" as const,
    json_schema: {
      name: "summarise_report",
      schema: {
        type: "object",
        properties: {
          reasoning: {
            type: "string",
            description:
              "The reasoning behind the intent you inferred from the message.",
          },
          is_access_blocked: {
            type: "boolean",
            description:
              "True if the content or URL sent by the user to be checked is inaccessible/removed/blocked. An example is being led to a login page instead of post content.",
          },
          is_video: {
            type: "boolean",
            description:
              "True if the content or URL sent by the user to be checked points to a video (e.g., YouTube, TikTok, Instagram Reels, Facebook videos).",
          },
          intent: {
            type: "string",
            description:
              "What the user's intent is, e.g. to check whether this is a scam, to check if this is really from the government, to check the facts in this article, etc.",
          },
        },
        required: ["is_access_blocked", "is_video", "reasoning", "intent"],
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
          urls = params.text.match(urlRegexSafe()) || [];
        } else if (params.imageUrl) {
          const captionSuffix = params.caption
            ? `this caption: ${params.caption}`
            : "no caption";
          userContent = [
            {
              type: "text",
              text: `User sent in the following image with ${captionSuffix}`,
            },
            {
              type: "image",
              image_url: {
                url: params.imageUrl,
              },
            },
          ];
          urls = [];
          //TODO LATER: get URLs from image
        } else {
          throw new Error("No text or image_url provided");
        }

        //get screenshot from URLs
        const screenshots = await Promise.all(
          urls.map((url) =>
            context.env.SCREENSHOT_SERVICE.screenshot({
              url,
              id: context.id,
            }).then((result) => ({
              ...result,
              url,
            }))
          )
        );

        //get openAI-formatted content for screenshots
        const screenshotContent = getOpenAIContent(screenshots);

        //extend userContent with screenshotContent
        userContent = [...userContent, ...screenshotContent];

        const preprocessPrompt = await context.langfuse.getPrompt(
          "preprocess_inputs",
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

        return {
          success: true,
          result: { ...result, starting_content: userContent },
        };
      } catch (error) {
        // Log the error
        context.logger.error(error, "Error in preprocess inputs tool");
        throw error;
      }
    }
  ),
};
