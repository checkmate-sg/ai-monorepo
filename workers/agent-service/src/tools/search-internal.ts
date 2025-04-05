import { CommunityNote } from "@workspace/shared-types";
import { Tool, ToolContext } from "./types";
import { withLangfuseSpan } from "./utils";
import type { ErrorResponse, ServiceResponse } from "@workspace/shared-types";
import { createLogger } from "@workspace/shared-utils";
import { Embedding } from "openai/resources/embeddings";
export interface SearchInternalParams {
  text: string;
}

export interface SearchInternalResponse extends ServiceResponse {
  success: true;
  result: {
    id: string | null;
    similarityScore: number | null;
    isMatch: boolean;
    reasoning: string | null;
    text: string;
    communityNote: CommunityNote | null;
    crowdsourcedCategory: string | null;
  };
}

const logger = createLogger("search-internal");

export type SearchInternalResult = SearchInternalResponse | ErrorResponse;

export const searchInternalTool: Tool<
  SearchInternalParams,
  SearchInternalResult
> = {
  definition: {
    type: "function",
    function: {
      name: "search_internal",
      description:
        "Searches the internal database for a previous submission most similar to the one provided, and returns that as well as the previous community note that was generated, if any, and an assessment of whether it's relevant.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "The submission text to conduct a similarity search on. If it's an image, you can still describe it/the claims within it, as similar results might still emerge.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  execute: withLangfuseSpan(
    "search-internal",
    async (
      params: SearchInternalParams,
      context: ToolContext,
      span
    ): Promise<SearchInternalResult> => {
      return searchInternal(params.text, context.env);
    }
  ),
};

export async function searchInternal(
  text: string,
  env: Env
): Promise<SearchInternalResult> {
  try {
    //embed the text
    let embedding: Embedding;
    try {
      embedding = await env.EMBEDDER_SERVICE.embed({
        text,
      });
    } catch (error) {
      throw new Error("Error embedding text");
    }

    if (!embedding) {
      throw new Error("Error embedding text");
    }

    // Call vectorSearch with the embedding
    const searchResults = await env.DATABASE_SERVICE.vectorSearch(
      embedding.embedding,
      1
    );

    if (
      !searchResults.success ||
      !searchResults.data ||
      searchResults.data.length === 0
    ) {
      return {
        success: true,
        result: {
          id: null,
          similarityScore: null,
          isMatch: false,
          reasoning: null,
          text,
          communityNote: null,
          crowdsourcedCategory: null,
        },
      };
    }

    // Get the top result
    const topResult = searchResults.data[0];

    // Construct community note from shortformResponse
    const communityNote = topResult.shortformResponse;
    const crowdResult = topResult.crowdsourcedCategory;
    const score = topResult.score;
    const isMatch = score > 0.85;

    return {
      success: true,
      result: {
        id: topResult.id,
        similarityScore: topResult.score,
        isMatch: isMatch,
        reasoning: `Similarity score: ${score} is above the threshold of 0.85.`,
        text,
        communityNote,
        crowdsourcedCategory: crowdResult,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      logger.error("Error in searchInternal:", error.message);
    } else {
      logger.error("Error in searchInternal", error);
    }
    return {
      success: false,
      error: {
        message: "Error in searchInternal",
        code: "SEARCH_INTERNAL_ERROR",
        details: error,
      },
    };
  }
}
