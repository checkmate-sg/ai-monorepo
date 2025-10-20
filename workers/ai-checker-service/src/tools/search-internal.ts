import { tool } from "ai";
import { z } from "zod";
import { CheckContext } from "../types";
import { searchInternal } from "../lib/search-internal";
import { AgentRequest } from "@workspace/shared-types";

export type {
  SearchInternalResponse,
  SearchInternalResult,
} from "../lib/search-internal";

interface ToolContext {
  id?: string;
}

export const createSearchInternalTool = (
  checkCtx: CheckContext,
  context: ToolContext
) => {
  return tool({
    description:
      "Searches the internal database for a previous submission most similar to the one provided, and returns that as well as the previous community note that was generated, if any, and an assessment of whether it's relevant.",
    parameters: z.object({
      text: z
        .string()
        .describe(
          "The submission text to conduct a similarity search on. If it's an image, you can still describe it/the claims within it, as similar results might still emerge."
        ),
    }),
    execute: async ({ text }: { text: string }) => {
      const childLogger = checkCtx.logger.child({ tool: "search-internal" });
      childLogger.info({ text: text.substring(0, 100) }, "Searching internal database");

      // Create a minimal AgentRequest from the tool params
      const request: AgentRequest = {
        id: context.id || crypto.randomUUID(),
        text,
        // Tool doesn't have image/caption info
      };

      const result = await searchInternal(request, checkCtx);

      if (!result.success) {
        childLogger.error({ error: result.error }, "Search internal failed");
        return {
          searched: false,
          error: result.error.message,
        };
      }

      childLogger.info(
        {
          isMatch: result.result.isMatch,
          matchType: result.result.matchType,
          similarityScore: result.result.similarityScore,
        },
        "Search internal completed"
      );

      return {
        searched: true,
        ...result.result,
      };
    },
  } as any);
};
