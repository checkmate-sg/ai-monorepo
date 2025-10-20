import { AgentRequest, ErrorResponse } from "@workspace/shared-types";
import { CheckContext } from "../types";
import { SearchInternalResult, searchInternal } from "../lib/search-internal";

export type FindSimilarResult = SearchInternalResult | ErrorResponse;

export async function findSimilar(
  options: AgentRequest,
  checkCtx: CheckContext
): Promise<FindSimilarResult> {
  const childLogger = checkCtx.logger.child({ step: "find-similar" });
  checkCtx.logger = childLogger;
  try {
    const result = await searchInternal(options, checkCtx);
    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    childLogger.error({ error, errorMessage }, "Error in findSimilar");
    return {
      success: false,
      error: {
        message: `Error in findSimilar: ${errorMessage}`,
        code: "FIND_SIMILAR_ERROR",
        details: error,
      },
    };
  }
}
