import { tool } from "ai";
import { z } from "zod";
import { CheckContext } from "../types";

interface ToolContext {
  id?: string;
}

export const createSearchGoogleTool = (
  checkCtx: CheckContext,
  context: ToolContext
) => {
  return tool({
    description:
      "Search Google for information to verify claims, check for scams, or find reliable sources. Returns organic search results from Google.",
    inputSchema: z.object({
      q: z.string().describe("The search query"),
    }),
    execute: async ({ q }: { q: string }) => {
      const childLogger = checkCtx.logger.child({ tool: "search-google" });
      childLogger.info({ q }, "Searching Google");
      // Call search-service binding
      const env = checkCtx.env;
      const result = await env.SEARCH_SERVICE.search({
        q,
        id: context.id,
      });

      childLogger.info({ result }, "Google search completed");

      if (!result.success) {
        return {
          query: q,
          error: result.error.message,
          searched: false,
        };
      }

      return {
        query: q,
        results: result.result,
        searched: true,
      };
    },
  } as any);
};
