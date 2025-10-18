import { tool } from "ai";
import { z } from "zod";

interface ToolContext {
  id?: string;
  screenshotsRemaining: number;
}

export const createUrlScreenshotTool = (env: Env, context: ToolContext) => {
  return tool({
    description: "Capture a screenshot of a URL to analyze its content",
    parameters: z.object({
      url: z.string().url().describe("The URL to screenshot"),
    }),
    execute: async ({ url }: { url: string }) => {
      if (context.screenshotsRemaining <= 0) {
        throw new Error("No screenshots remaining");
      }

      // Call screenshot-service binding
      const result = await env.SCREENSHOT_SERVICE.screenshot({
        url,
        id: context.id,
      });

      if (!result.success) {
        return {
          url,
          imageUrl: null,
          base64: null,
          success: false,
          error: result.error,
        };
      }

      // Decrement screenshots remaining
      if (
        context &&
        context.screenshotsRemaining &&
        context.screenshotsRemaining > 0
      ) {
        context.screenshotsRemaining -= 1;
      }

      return {
        url,
        imageUrl: result.result.imageUrl,
        base64: result.result.base64,
        success: true,
      };
    },
  } as any);
};
