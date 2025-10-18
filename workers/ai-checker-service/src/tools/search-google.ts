import { tool } from "ai";
import { z } from "zod";

interface ToolContext {
  id?: string;
  searchesRemaining: number;
}

export const createSearchGoogleTool = (env: Env, context: ToolContext) => {
  return tool({
    description: "Search Google for information to help with fact-checking",
    parameters: z.object({
      q: z.string().describe("The search query"),
    }),
    execute: async ({ q }) => {
      if (context.searchesRemaining <= 0) {
        throw new Error("No searches remaining");
      }

      // Call search-service binding
      const result = await env.SEARCH_SERVICE.search({
        q,
        id: context.id,
      });

      if (!result.success) {
        throw new Error(result.error.message);
      }

      // Decrement searches remaining
      context.searchesRemaining -= 1;

      return {
        results: result.result,
        query: q,
      };
    },
  });
};
