import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { getPreprocessingSystemPrompt } from "../prompts/preprocessing";
import {
  ErrorResponse,
  AgentRequest,
  ScreenshotResponse,
  ScreenshotResult,
} from "@workspace/shared-types";
import { createLogger } from "@workspace/shared-utils";

export type AgentRequestWithUrls = AgentRequest & {
  extractedUrls?: string[];
  imageBase64?: string;
};

export interface PreprocessResponse {
  success: true;
  result: {
    canBeAssessed: boolean;
    isAccessBlocked: boolean;
    isVideo: boolean;
    intent: string;
    startingContent: any[];
    title: string | null;
  };
}

export type PreprocessResult = PreprocessResponse | ErrorResponse;

export async function preprocessInputs(
  options: AgentRequestWithUrls,
  env: Env,
  logger = createLogger("preprocess-inputs")
): Promise<PreprocessResult> {
  const childLogger = logger.child({ step: "preprocess-inputs" });

  try {
    const google = createGoogleGenerativeAI({
      apiKey: env.GEMINI_API_KEY,
    });
    const model = google("gemini-2.5-pro");
    const { text, imageUrl, imageBase64, caption, extractedUrls } = options;

    if (!imageBase64 && !imageUrl) {
      throw new Error("No image buffer or image URL provided");
    }

    // Build user content based on input type
    let userContent: any[] = [];

    if ("text" in options && text) {
      //if it's a text message
      userContent.push({
        type: "text",
        text: `User sent in: ${text}`,
      });
    } else if ("imageUrl" in options && imageUrl) {
      //if it's an image message
      const captionText = caption
        ? `with caption: ${caption}`
        : "with no caption";
      userContent.push({
        type: "text",
        text: `User sent in the following image ${captionText}`,
      });
      userContent.push({
        type: "image",
        image: imageBase64 ?? imageUrl,
      });
    }

    // Add extracted URLs context if available
    if (extractedUrls && extractedUrls.length > 0) {
      // Get screenshots for URLs
      const screenshotPromises = extractedUrls.map(async (url) => {
        try {
          const result = await env.SCREENSHOT_SERVICE.screenshot({
            url,
            id: options.id,
          });
          return result;
        } catch (error) {
          childLogger.error({ error, url }, "Failed to get screenshot");
          return {
            success: false,
            error: {
              message: error instanceof Error ? error.message : "Unknown error",
            },
          };
        }
      });

      const screenshots = await Promise.all(screenshotPromises);

      // Add screenshots to user content
      screenshots.forEach((screenshot: ScreenshotResult, index: number) => {
        if (screenshot.success) {
          userContent.push({
            type: "text",
            text: `Screenshot of ${extractedUrls[index]} below:`,
          });
          userContent.push({
            type: "image",
            image: screenshot.result.base64 ?? screenshot.result.imageUrl,
          });
        } else {
          userContent.push({
            type: "text",
            text: `Failed to get screenshot of ${extractedUrls[index]}: ${screenshot.error.message}`,
          });
        }
      });
    }

    const { object } = await (generateObject as any)({
      model: model,
      system: getPreprocessingSystemPrompt(),
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
      schema: z.object({
        intent: z
          .string()
          .describe(
            "What the user's intent is, e.g. to check whether this is a scam, to check if this is really from the government, to check the facts in this article, etc."
          ),
        canBeAssessed: z
          .boolean()
          .describe(
            "Whether you are confident that the information currently available is sufficient for the next agent, given google search and a malicious URL scanner, to assess this message."
          ),
        isAccessBlocked: z
          .boolean()
          .describe(
            "True if critical information needed to assess this submission is behind a blocked webpage. Otherwise false."
          ),
        isVideo: z
          .boolean()
          .describe(
            "True if there is a video that needs to be watched in order to properly assess this submission."
          ),
        title: z
          .string()
          .describe(
            "A title, less than 8 words, describing the check to be done. E.g. 'Article on budget measures at mofbudget.life' or 'Claim that strawberry quick is circulating'. Do not include names, addresses, or phone numbers."
          ),
      }),
    });

    const canBeAssessed = object.canBeAssessed;
    const isAccessBlocked = object.isAccessBlocked && !canBeAssessed;
    const isVideo = object.isVideo;

    // TODO: Screenshot URLs found in content/image

    childLogger.info(
      {
        // cast to satisfy types from ai sdk generic output
        ...object,
        isAccessBlocked,
        isVideo,
        startingContent: userContent,
      },
      "Preprocessing result"
    );

    return {
      success: true,
      result: {
        // cast to satisfy types from ai sdk generic output
        ...object,
        isAccessBlocked,
        isVideo,
        startingContent: userContent,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    childLogger.error({ error, errorMessage }, "Error in preprocessInputs");

    return {
      success: false,
      error: {
        message: errorMessage,
      },
    };
  }
}
