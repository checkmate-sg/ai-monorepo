import { SearchResult } from "@workspace/shared-types";
import { Tool, ToolContext } from "./types";
import { withLangfuseSpan } from "./utils";

export interface SearchGoogleParams {
  q: string;
}

export const searchGoogleTool: Tool<SearchGoogleParams, SearchResult> = {
  definition: {
    type: "function",
    function: {
      name: "search_google",
      description:
        "Searches Google for the given query and returns organic search results using serper.dev. Call this when you need to retrieve information from Google search results.",
      parameters: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "The search query to use on Google.",
          },
        },
        required: ["q"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  execute: withLangfuseSpan(
    "search-google",
    async (
      params: SearchGoogleParams,
      context: ToolContext,
      span
    ): Promise<SearchResult> => {
      if (context.getSearchesRemaining() <= 0) {
        throw new Error("Search limit reached");
      }

      context.logger.info({ query: params.q }, "Executing search tool");
      context.decrementSearches();

      const result = await context.env.SEARCH_SERVICE.search({
        q: params.q,
        id: context.id,
      });

      return result;
    }
  ),
};
