import { CommunityNote, AgentRequest } from "@workspace/shared-types";
import { Tool, ToolContext } from "./types";
import { withLangfuseSpan, withTimeout } from "./utils";
import type { ErrorResponse, ServiceResponse } from "@workspace/shared-types";
import {
  createLogger,
  hashText,
  hashImage,
  compareImageHashes,
  pdqHashToVector,
} from "@workspace/shared-utils";
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
    imageHammingDistance: number | null;
    isMatch: boolean;
    reasoning: string | null;
    text: string;
    matchType: "text" | "image" | "both" | null;
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
      // Create a minimal AgentRequest from the tool params
      const request: AgentRequest = {
        id: crypto.randomUUID(),
        text: params.text,
        // Tool doesn't have image/caption info
      };

      return searchInternal(
        request,
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
  request: AgentRequest,
  env: Env,
  langfuse: Langfuse | null,
  span: ReturnType<Langfuse["span"]> | null,
  logger: ReturnType<typeof createLogger>,
  llmCheck: boolean = false
): Promise<SearchInternalResult> {
  const { text, imageUrl, caption } = request;

  // Determine submission type
  const hasText = !!text;
  const hasImage = !!imageUrl;
  const hasCaption = !!caption;

  logger.debug(
    { hasText, hasImage, hasCaption },
    "Routing search based on submission type"
  );

  try {
    // Route to appropriate handler
    if (hasText && !hasImage) {
      return await searchTextSubmission(
        text,
        env,
        langfuse,
        span,
        logger,
        llmCheck
      );
    } else if (hasImage && !hasCaption) {
      return await searchImageOnlySubmission(
        imageUrl,
        env,
        langfuse,
        span,
        logger
      );
    } else if (hasImage && hasCaption) {
      return await searchImageWithCaptionSubmission(
        imageUrl,
        caption,
        env,
        langfuse,
        span,
        logger
      );
    } else {
      throw new Error("Invalid submission type");
    }
  } catch (error) {
    if (error instanceof Error) {
      logger.error({ error }, "Error in searchInternal");
    } else {
      logger.error({ error }, "Error in searchInternal");
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

// =====================================
// Handler: Text-only submissions
// =====================================
async function searchTextSubmission(
  text: string,
  env: Env,
  langfuse: Langfuse | null,
  span: ReturnType<Langfuse["span"]> | null,
  logger: ReturnType<typeof createLogger>,
  llmCheck: boolean
): Promise<SearchInternalResult> {
  try {
    // First, try to find exact match by text hash
    logger.debug(
      { text: text.substring(0, 100) },
      "Text-only - checking for exact hash match first"
    );

    const textHash = await hashText(text);
    const hashResult = await env.DATABASE_SERVICE.findCheckByTextHash(textHash);

    if (hashResult.success && hashResult.data) {
      logger.info(
        {
          checkId: hashResult.data._id,
          textHash,
          method: "hash_lookup",
        },
        "Found exact match via text hash"
      );

      return {
        success: true,
        result: {
          id: hashResult.data._id,
          similarityScore: 1.0,
          imageHammingDistance: null,
          isMatch: true,
          reasoning: "Exact text match found via hash lookup",
          text,
          matchType: "text",
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

    // Call findSimilarTextEmbedding with the embedding
    const startTime = Date.now();
    const searchResults = await env.DATABASE_SERVICE.findSimilarTextEmbedding(
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
          imageHammingDistance: null,
          isMatch: false,
          reasoning: null,
          text,
          matchType: null,
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
    const matchType: "text" | "image" | "both" | null = isMatch ? "text" : null;

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
        const response = await withTimeout(
          observedClient.chat.completions.create({
            model: config.model || "gpt-4.1-mini",
            temperature: config.temperature || 0.0,
            seed: config.seed || 11,
            messages: messages as any[],
            response_format: config.response_format,
          }),
          30000, // 30 seconds timeout
          "Confirm same claim LLM call"
        );
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
              imageHammingDistance: null,
              isMatch: result.are_variants_of_same_claim,
              reasoning: result.reasoning,
              text,
              matchType: result.are_variants_of_same_claim ? "text" : null,
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
        imageHammingDistance: null,
        isMatch: isMatch,
        reasoning: `Similarity score: ${score} is above the threshold of 0.85.`,
        text,
        matchType,
        communityNote,
        crowdsourcedCategory: crowdResult,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      logger.error({ error }, "Error in searchTextSubmission");
    } else {
      logger.error({ error }, "Error in searchTextSubmission");
    }
    return {
      success: false,
      error: {
        message: "Error in searchTextSubmission",
        code: "SEARCH_TEXT_ERROR",
        details: error,
      },
    };
  }
}

// =====================================
// Handler: Image-only submissions
// =====================================
async function searchImageOnlySubmission(
  imageUrl: string,
  env: Env,
  langfuse: Langfuse | null,
  span: ReturnType<Langfuse["span"]> | null,
  logger: ReturnType<typeof createLogger>
): Promise<SearchInternalResult> {
  try {
    logger.debug({ imageUrl }, "Image-only - generating PDQ hash");

    // Generate PDQ hash
    const imageData = await fetch(imageUrl).then((r) => r.arrayBuffer());
    const pdqHash = await hashImage(
      new Uint8Array(imageData),
      env.IMAGE_HASH_SERVICE
    );

    logger.debug({ pdqHash }, "PDQ hash generated, converting to vector");

    // Convert to vector for search
    const pdqVector = pdqHashToVector(pdqHash);

    // Search for similar images
    const searchResults = await env.DATABASE_SERVICE.findSimilarImageEmbedding(
      pdqVector,
      1
    );

    if (
      !searchResults.success ||
      !searchResults.data ||
      searchResults.data.length === 0
    ) {
      logger.info("No similar images found");
      return {
        success: true,
        result: {
          id: null,
          similarityScore: null,
          imageHammingDistance: null,
          isMatch: false,
          reasoning: "No similar images found",
          text: "",
          matchType: null,
          communityNote: null,
          crowdsourcedCategory: null,
        },
      };
    }

    const topResult = searchResults.data[0];

    // Compute actual hamming distance
    const hammingDistance = topResult.imageHash
      ? compareImageHashes(pdqHash, topResult.imageHash)
      : null;

    const isMatch = hammingDistance !== null && hammingDistance < 31;

    logger.info(
      {
        hammingDistance,
        threshold: 31,
        isMatch,
        euclideanDistance: topResult.distance,
      },
      "Image similarity evaluated"
    );

    return {
      success: true,
      result: {
        id: topResult.id,
        similarityScore: null,
        imageHammingDistance: hammingDistance,
        isMatch,
        reasoning: isMatch
          ? `Image hamming distance: ${hammingDistance} is below threshold of 31`
          : `Image hamming distance: ${hammingDistance} exceeds threshold`,
        text: "",
        matchType: isMatch ? "image" : null,
        communityNote: topResult.shortformResponse || null,
        crowdsourcedCategory: topResult.crowdsourcedCategory || null,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      logger.error({ error }, "Error in searchImageOnlySubmission");
    } else {
      logger.error({ error }, "Error in searchImageOnlySubmission");
    }
    return {
      success: false,
      error: {
        message: "Error in searchImageOnlySubmission",
        code: "SEARCH_IMAGE_ERROR",
        details: error,
      },
    };
  }
}

// =====================================
// Handler: Image + Caption submissions
// =====================================
async function searchImageWithCaptionSubmission(
  imageUrl: string,
  caption: string,
  env: Env,
  langfuse: Langfuse | null,
  span: ReturnType<Langfuse["span"]> | null,
  logger: ReturnType<typeof createLogger>
): Promise<SearchInternalResult> {
  try {
    logger.debug(
      { imageUrl, caption: caption.substring(0, 100) },
      "Image+Caption - generating PDQ hash"
    );

    // Generate PDQ hash
    const imageData = await fetch(imageUrl).then((r) => r.arrayBuffer());
    const pdqHash = await hashImage(
      new Uint8Array(imageData),
      env.IMAGE_HASH_SERVICE
    );
    const pdqVector = pdqHashToVector(pdqHash);

    // Search for similar images (get top 5 candidates)
    const imageSearchResults =
      await env.DATABASE_SERVICE.findSimilarImageEmbedding(pdqVector, 5);

    if (
      !imageSearchResults.success ||
      !imageSearchResults.data ||
      imageSearchResults.data.length === 0
    ) {
      logger.info("No similar images found");
      return {
        success: true,
        result: {
          id: null,
          similarityScore: null,
          imageHammingDistance: null,
          isMatch: false,
          reasoning: "No similar images found",
          text: caption,
          matchType: null,
          communityNote: null,
          crowdsourcedCategory: null,
        },
      };
    }

    // Check caption hash for each candidate
    const captionHash = await hashText(caption);

    for (const candidate of imageSearchResults.data) {
      if (!candidate.imageHash) continue;

      const hammingDistance = compareImageHashes(pdqHash, candidate.imageHash);

      // Image must be similar (hamming distance < 31)
      if (hammingDistance < 31) {
        // Check if caption hash matches
        const candidateCaptionHash = candidate.caption
          ? await hashText(candidate.caption)
          : null;

        if (candidateCaptionHash === captionHash) {
          logger.info(
            {
              checkId: candidate.id,
              hammingDistance,
              method: "image_caption_hash_match",
            },
            "Found match: both image and caption hashes match"
          );

          return {
            success: true,
            result: {
              id: candidate.id,
              similarityScore: null,
              imageHammingDistance: hammingDistance,
              isMatch: true,
              reasoning: "Both image and caption hashes match",
              text: caption,
              matchType: "both",
              communityNote: candidate.shortformResponse || null,
              crowdsourcedCategory: candidate.crowdsourcedCategory || null,
            },
          };
        }
      }
    }

    // No match found
    logger.info("No candidates with matching image and caption");
    return {
      success: true,
      result: {
        id: null,
        similarityScore: null,
        imageHammingDistance: null,
        isMatch: false,
        reasoning: "No candidates with both matching image and caption",
        text: caption,
        matchType: null,
        communityNote: null,
        crowdsourcedCategory: null,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      logger.error({ error }, "Error in searchImageWithCaptionSubmission");
    } else {
      logger.error({ error }, "Error in searchImageWithCaptionSubmission");
    }
    return {
      success: false,
      error: {
        message: "Error in searchImageWithCaptionSubmission",
        code: "SEARCH_IMAGE_CAPTION_ERROR",
        details: error,
      },
    };
  }
}
