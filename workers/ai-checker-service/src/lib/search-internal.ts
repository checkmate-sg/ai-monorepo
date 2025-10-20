import {
  AgentRequest,
  CommunityNote,
  ErrorResponse,
  ServiceResponse,
} from "@workspace/shared-types";
import {
  hashText,
  hashImage,
  pdqHashToVector,
  compareImageHashes,
} from "@workspace/shared-utils";
import { CheckContext } from "../types";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { confirmSameClaimPrompt } from "../prompts/confirm-same-claim";

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

export type SearchInternalResult = SearchInternalResponse | ErrorResponse;

export async function searchInternal(
  request: AgentRequest,
  checkCtx: CheckContext
): Promise<SearchInternalResult> {
  const logger = checkCtx.logger.child({ tool: "search-internal" });
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
      return await searchTextSubmission(text, true, checkCtx);
    } else if (hasImage && !hasCaption) {
      return await searchImageOnlySubmission(imageUrl, checkCtx);
    } else if (hasImage && hasCaption) {
      return await searchImageWithCaptionSubmission(
        imageUrl,
        caption,
        checkCtx
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
  llmCheck: boolean,
  checkCtx: CheckContext
): Promise<SearchInternalResult> {
  const logger = checkCtx.logger.child({ tool: "search-internal-text" });
  const env = checkCtx.env;
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

    let embedding: any;
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
      const text1 = topResult.text;
      const text2 = text;

      try {
        const openai = createOpenAI({
          apiKey: env.OPENAI_API_KEY,
        });

        const google = createGoogleGenerativeAI({
          apiKey: env.GEMINI_API_KEY,
        });

        logger.info(
          {
            text1: text1.substring(0, 100),
            text2: text2.substring(0, 100),
          },
          "Confirming same claim with LLM"
        );

        const { object } = await (generateObject as any)({
          model: google("gemini-2.5-flash"),
          schema: z.object({
            are_variants_of_same_claim: z.boolean(),
            reasoning: z.string(),
          }),
          system: confirmSameClaimPrompt,
          prompt: `# Text 1
${text1}

# Text 2
${text2}`,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "confirm-same-claim",
            metadata: {
              langfuseTraceId: checkCtx.trace?.id ?? "",
              langfuseUpdateParent: false,
            },
          },
        });

        logger.debug(
          {
            llmResponse: object,
            originalScore: topResult.score,
            llmDecision: object.are_variants_of_same_claim,
          },
          "LLM same claim check completed"
        );

        logger.info(
          {
            finalMatch: object.are_variants_of_same_claim,
            similarityScore: topResult.score,
            llmReasoning: object.reasoning?.substring(0, 200),
          },
          "Final match decision after LLM check"
        );

        return {
          success: true,
          result: {
            id: topResult.id,
            similarityScore: topResult.score,
            imageHammingDistance: null,
            isMatch: object.are_variants_of_same_claim,
            reasoning: object.reasoning,
            text,
            matchType: object.are_variants_of_same_claim ? "text" : null,
            communityNote,
            crowdsourcedCategory: crowdResult,
          },
        };
      } catch (error: unknown) {
        // Log the error with proper type handling
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

        logger.error({ error, errorMessage }, "Error confirming same claim");

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
  checkCtx: CheckContext
): Promise<SearchInternalResult> {
  const logger = checkCtx.logger.child({ tool: "search-internal-image-only" });
  const env = checkCtx.env;
  try {
    logger.debug({ imageUrl }, "Image-only - generating PDQ hash");

    // Generate PDQ hash
    const imageData = await fetch(imageUrl).then((r) => r.arrayBuffer());
    const pdqHash = await hashImage(
      new Uint8Array(imageData),
      env.IMAGE_HASH_SERVICE
    );

    // Check for exact image hash match first
    const hashResult = await env.DATABASE_SERVICE.findCheckByImageHash(
      pdqHash,
      null
    );

    if (hashResult.success && hashResult.data) {
      logger.info(
        {
          checkId: hashResult.data._id,
          pdqHash,
          method: "image_hash_lookup",
        },
        "Found exact image match via PDQ hash lookup"
      );

      return {
        success: true,
        result: {
          id: hashResult.data._id,
          similarityScore: null,
          imageHammingDistance: 0,
          isMatch: true,
          reasoning: "Exact image match found via PDQ hash lookup",
          text: "",
          matchType: "image",
          communityNote: hashResult.data.shortformResponse || null,
          crowdsourcedCategory: hashResult.data.crowdsourcedCategory || null,
        },
      };
    }

    logger.debug(
      { pdqHash },
      "No exact image hash match, proceeding with vector search"
    );

    // Convert to vector for search
    const pdqVector = pdqHashToVector(pdqHash);

    // Search for similar images (only those without captions)
    const searchResults = await env.DATABASE_SERVICE.findSimilarImageEmbedding(
      pdqVector,
      1,
      false
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
  checkCtx: CheckContext
): Promise<SearchInternalResult> {
  const logger = checkCtx.logger.child({
    tool: "search-internal-image-with-caption",
  });
  const env = checkCtx.env;
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
    const captionHash = await hashText(caption);

    // Check for exact image hash and caption hash match first
    const imageHashResult = await env.DATABASE_SERVICE.findCheckByImageHash(
      pdqHash,
      captionHash
    );

    if (imageHashResult.success && imageHashResult.data) {
      logger.info(
        {
          checkId: imageHashResult.data._id,
          pdqHash,
          captionHash,
          method: "image_caption_exact_hash_match",
        },
        "Found exact match via both image and caption hash lookup"
      );

      return {
        success: true,
        result: {
          id: imageHashResult.data._id,
          similarityScore: null,
          imageHammingDistance: 0,
          isMatch: true,
          reasoning:
            "Exact match found via both image PDQ hash and caption hash lookup",
          text: caption,
          matchType: "both",
          communityNote: imageHashResult.data.shortformResponse || null,
          crowdsourcedCategory:
            imageHashResult.data.crowdsourcedCategory || null,
        },
      };
    }

    logger.debug("No exact match found, proceeding with fuzzy image search");

    const pdqVector = pdqHashToVector(pdqHash);

    // Search for similar images (get top 5 candidates with captions)
    const imageSearchResults =
      await env.DATABASE_SERVICE.findSimilarImageEmbedding(pdqVector, 5, true);

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
