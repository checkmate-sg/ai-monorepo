import { ScreenshotResult } from "@workspace/shared-types";
import { Tool } from "./types";
import { withLangfuseSpan } from "./utils";

export interface ScreenshotParams {
  url: string;
}

export const websiteScreenshotTool: Tool<ScreenshotParams, ScreenshotResult> = {
  definition: {
    type: "function",
    function: {
      name: "get_website_screenshot",
      description:
        "Takes a screenshot of the url provided. Call this when you need to look at the web page.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL of the website to take a screenshot of.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  execute: withLangfuseSpan<ScreenshotParams, ScreenshotResult>(
    "get-website-screenshot",
    async (params, context, span) => {
      if (context.getScreenshotsRemaining() <= 0) {
        throw new Error("Screenshot limit reached");
      }

      context.logger.info({ url: params.url }, "Executing screenshot tool");
      context.decrementScreenshots();
      try {
        return await context.env.SCREENSHOT_SERVICE.screenshot({
          url: params.url,
          id: context.id,
        });
      } catch (error) {
        context.logger.error(
          { url: params.url, error },
          "Error executing screenshot tool"
        );
        throw error;
      }
    }
  ),
};
