import { ErrorResponse, ServiceResponse } from "@workspace/shared-types";
import { CheckContext } from "../types";

export interface UpdateCheckResult extends ServiceResponse {
  success: true;
  result: {
    checkId: string;
  };
}

export type UpdateCheckResponse = UpdateCheckResult | ErrorResponse;

export async function updateCheck(
  checkId: string,
  updateData: Record<string, any>,
  checkCtx: CheckContext,
  waitUntil?: (promise: Promise<any>) => void
): Promise<UpdateCheckResponse> {
  const logger = checkCtx.logger.child({ function: "updateCheck" });
  const env = checkCtx.env;

  try {
    if (waitUntil) {
      // Run in background
      waitUntil(
        env.DATABASE_SERVICE.updateCheck(checkId, updateData).catch((error) => {
          logger.error({ error, checkId }, "Failed to update check");
          throw error;
        })
      );
      return {
        success: true,
        result: {
          checkId,
        },
      };
    } else {
      // Await the update
      await env.DATABASE_SERVICE.updateCheck(checkId, updateData);
      return {
        success: true,
        result: {
          checkId,
        },
      };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    logger.error({ error, checkId }, "Failed to update check");
    return {
      success: false,
      error: {
        message: `Error updating check: ${errorMessage}`,
        code: "UPDATE_CHECK_ERROR",
        details: error,
      },
    };
  }
}
