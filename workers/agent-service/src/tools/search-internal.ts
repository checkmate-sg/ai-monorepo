import { CommunityNote } from "@workspace/shared-types";
import { Tool, ToolContext } from "./types";
import { withLangfuseSpan } from "./utils";
import type { ErrorResponse, ServiceResponse } from "@workspace/shared-types";
import { createLogger, hashText } from "@workspace/shared-utils";
import { Embedding } from "openai/resources/embeddings";
import { createClient } from "@workspace/shared-llm-client";
import { Langfuse, observeOpenAI } from "langfuse";
export interface SearchInternalParams {
  text: string;
  llmCheck: boolean;
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

const configObject = {
  model: "gpt-4.1-mini",
  temperature: 0,
  seed: 11,
  response_format: {
    type: "json_schema" as const,
    json_schema: {
      name: "confirm_same_claim",
      schema: {
        type: "object",
        properties: {
          reasoning: {
            type: "string",
            description:
              "An explanation of whether the two texts are variants of the same claim for fact-checking purposes.",
          },
          are_variants_of_same_claim: {
            type: "boolean",
            description:
              "A flag indicating whether the two texts should be treated as variants of the same claim.",
          },
        },
        required: ["reasoning", "are_variants_of_same_claim"],
        additionalProperties: false,
      },
    },
  },
};

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
      return searchInternal(
        params.text,
        context.env,
        context.langfuse,
        span,
        context.logger,
        params.llmCheck
      );
    }
  ),
};

export async function searchInternal(
  text: string,
  env: Env,
  langfuse: Langfuse | null,
  span: ReturnType<Langfuse["span"]> | null,
  logger: ReturnType<typeof createLogger>,
  llmCheck: boolean = false
): Promise<SearchInternalResult> {
  try {
    // First, try to find exact match by text hash
    logger.debug(
      { text: text.substring(0, 100) },
      "Starting search - checking for exact hash match first"
    );

    const textHash = await hashText(text);
    const hashResult = await env.DATABASE_SERVICE.findCheckByTextHash(textHash);
    
    if (hashResult.success && hashResult.data) {
      logger.info(
        { 
          checkId: hashResult.data._id,
          textHash,
          method: "hash_lookup" 
        },
        "Found exact match via text hash"
      );
      
      return {
        success: true,
        result: {
          id: hashResult.data._id,
          similarityScore: 1.0, // Exact match
          isMatch: true,
          reasoning: "Exact text match found via hash lookup",
          text,
          communityNote: hashResult.data.shortformResponse || null,
          crowdsourcedCategory: hashResult.data.crowdsourcedCategory || null,
        },
      };
    }

    logger.debug(
      { textHash },
      "No exact hash match found, proceeding with vector search"
    );

    let embedding: Embedding;
    try {
      embedding = await env.EMBEDDER_SERVICE.embed({
        text,
      });
      logger.debug(
        {
          embeddingDimensions: embedding.embedding.length,
          embeddingPreview: embedding.embedding.slice(0, 5),
        },
        "Successfully generated embedding"
      );
    } catch (error) {
      logger.error({ error }, "Failed to generate embedding");
      throw new Error("Error embedding text");
    }

    if (!embedding) {
      logger.error("Embedding service returned null");
      throw new Error("Error embedding text");
    }

    // Call vectorSearch with the embedding
    const startTime = Date.now();
    const searchResults = await env.DATABASE_SERVICE.vectorSearch(
      embedding.embedding,
      1
    );
    const searchDuration = Date.now() - startTime;

    logger.info(
      {
        searchDuration,
        success: searchResults.success,
        resultCount: searchResults.data?.length || 0,
      },
      "Vector search completed"
    );

    if (
      !searchResults.success ||
      !searchResults.data ||
      searchResults.data.length === 0
    ) {
      logger.info(
        {
          searchResults,
          text: text.substring(0, 100),
        },
        "No matching results found in vector search"
      );

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

    logger.debug(
      {
        resultId: topResult.id,
        similarityScore: topResult.score,
        resultTextPreview: topResult.text?.substring(0, 100),
        hasCommunityNote: !!topResult.shortformResponse,
        crowdsourcedCategory: topResult.crowdsourcedCategory,
      },
      "Top vector search result details"
    );

    // Construct community note from shortformResponse
    const communityNote = topResult.shortformResponse;
    const crowdResult = topResult.crowdsourcedCategory;
    const score = topResult.score;
    const isMatch = score > 0.85;

    logger.info(
      {
        score,
        threshold: 0.85,
        isMatch,
        llmCheckEnabled: llmCheck,
        willPerformLLMCheck: llmCheck && isMatch,
      },
      "Similarity matching evaluation"
    );

    if (llmCheck && isMatch) {
      let trace;
      if (!langfuse) {
        langfuse = new Langfuse({
          environment: env.ENVIRONMENT,
          publicKey: env.LANGFUSE_PUBLIC_KEY,
          secretKey: env.LANGFUSE_SECRET_KEY,
          baseUrl: env.LANGFUSE_HOST,
        });
        trace = langfuse.trace({
          name: "confirm-same-claim",
          input: {
            text1: topResult.text,
            text2: text,
          },
          id: crypto.randomUUID(),
        });
      }

      const text1 = topResult.text;
      const text2 = text;

      try {
        const client = await createClient("openai", env);
        const confirm_same_claim_prompt = await langfuse.getPrompt(
          "confirm_same_claim",
          undefined,
          {
            label:
              env.ENVIRONMENT === "production"
                ? "cf-production"
                : env.ENVIRONMENT,
            type: "chat",
          }
        );
        const observedClient = observeOpenAI(client, {
          clientInitParams: {
            publicKey: env.LANGFUSE_PUBLIC_KEY,
            secretKey: env.LANGFUSE_SECRET_KEY,
            baseUrl: env.LANGFUSE_HOST,
          },
          langfusePrompt: confirm_same_claim_prompt,
          parent: span ? span : trace,
        });
        logger.info(
          {
            text1,
            text2,
          },
          "Confirming same claim"
        );
        const config = confirm_same_claim_prompt.config as typeof configObject;
        const messages = confirm_same_claim_prompt.compile({
          text1,
          text2,
        }) as any[];
        const response = await observedClient.chat.completions.create({
          model: config.model || "gpt-4.1-mini",
          temperature: config.temperature || 0.0,
          seed: config.seed || 11,
          messages: messages as any[],
          response_format: config.response_format,
        });
        const content = response.choices[0].message.content;
        const result = JSON.parse(content || "{}");

        logger.debug(
          {
            llmResponse: result,
            originalScore: topResult.score,
            llmDecision: result.are_variants_of_same_claim,
          },
          "LLM same claim check completed"
        );

        if (trace) {
          trace.update({
            output: result,
            tags: [
              env.ENVIRONMENT,
              "single-call",
              "confirm-same-claim",
              "cloudflare-workers",
            ],
          });
        }

        if (result.are_variants_of_same_claim != null) {
          logger.info(
            {
              finalMatch: result.are_variants_of_same_claim,
              similarityScore: topResult.score,
              llmReasoning: result.reasoning?.substring(0, 200),
            },
            "Final match decision after LLM check"
          );

          // Flush Langfuse trace before returning
          await langfuse.flushAsync();

          return {
            success: true,
            result: {
              id: topResult.id,
              similarityScore: topResult.score,
              isMatch: result.are_variants_of_same_claim,
              reasoning: result.reasoning,
              text,
              communityNote,
              crowdsourcedCategory: crowdResult,
            },
          };
        } else {
          logger.error(
            { result },
            "LLM response missing are_variants_of_same_claim field"
          );
          throw new Error("No result from confirm same claim prompt");
        }
      } catch (error: unknown) {
        // Log the error with proper type handling
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

        logger.error({ error, errorMessage }, "Error confirming same claim");

        // Flush Langfuse trace even on error
        if (langfuse) {
          await langfuse.flushAsync();
        }

        return {
          success: false,
          error: {
            message: errorMessage,
          },
        };
      }
    }

    logger.info(
      {
        finalMatch: isMatch,
        similarityScore: score,
        matchReason: "similarity_threshold",
        threshold: 0.85,
      },
      "Returning match based on similarity threshold only"
    );

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
