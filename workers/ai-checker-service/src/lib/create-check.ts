import {
  hashText,
  hashImageFromUrl,
  pdqHashToVector,
} from "@workspace/shared-utils";
import {
  AgentRequest,
  ErrorResponse,
  ServiceResponse,
} from "@workspace/shared-types";
import { CheckContext } from "../types";

export interface CreateCheckResult extends ServiceResponse {
  success: true;
  result: {
    checkId: string;
    notificationId: number | null;
  };
}

export type CreateCheckResponse = CreateCheckResult | ErrorResponse;

export async function createCheck(
  request: AgentRequest,
  checkCtx: CheckContext,
  id: string,
  timestamp: Date,
  waitUntil?: (promise: Promise<any>) => void
): Promise<CreateCheckResponse> {
  const logger = checkCtx.logger.child({ function: "createCheck" });
  const env = checkCtx.env;

  let notificationId: number | null = null;

  try {
    // Extract data from request
    const text = request.text || null;
    const imageUrl = request.imageUrl || null;
    const caption = request.caption || null;
    const title = null; // Will be set during preprocessing
    const type = request.imageUrl ? "image" : "text";

    // Hash the text if it exists
    const textHash = text ? await hashText(text) : null;

    let imageHash: string | null = null;
    try {
      if (imageUrl) {
        imageHash = await hashImageFromUrl(imageUrl, env.IMAGE_HASH_SERVICE);
      }
    } catch (error) {
      logger.error("Failed to hash image");
    }

    const captionHash = caption ? await hashText(caption) : null;
    const pdqVector = imageHash ? pdqHashToVector(imageHash) : null;

    // Create the record immediately with null embeddings
    const insertResult = await env.DATABASE_SERVICE.insertCheck(
      {
        text: text,
        title: title,
        imageUrl: imageUrl,
        caption: caption,
        embeddings: {
          text: null,
          caption: null,
          pdq: pdqVector,
        },
        textHash: textHash,
        captionHash: captionHash,
        imageHash: imageHash,
        type: type,
        generationStatus: "pending",
        isControversial: false,
        isAccessBlocked: false,
        isVideo: false,
        timestamp: timestamp,
        longformResponse: {
          en: null,
          cn: null,
          ms: null,
          id: null,
          ta: null,
          links: null,
          timestamp: null,
        },
        shortformResponse: {
          en: null,
          cn: null,
          ms: null,
          id: null,
          ta: null,
          downvoted: false,
          links: null,
          timestamp: null,
        },
        humanResponse: null,
        machineCategory: null,
        crowdsourcedCategory: "unsure",
        pollId: null,
        isExpired: false,
        isHumanAssessed: false,
        isVoteTriggered: false,
        isApprovedForPublishing: false,
        approvedBy: null,
      },
      id
    );

    if (!insertResult.success) {
      throw new Error(`Failed to create check record: ${insertResult.error}`);
    }

    // Send notification if not rollback
    try {
      notificationId = await env.NOTIFICATION_SERVICE.sendNewCheckNotification({
        id: id,
        agentRequest: request,
      });

      if (waitUntil) {
        waitUntil(
          env.DATABASE_SERVICE.updateCheck(id, {
            notificationId: notificationId,
          })
        );
      } else {
        // If no state provided, await the update
        await env.DATABASE_SERVICE.updateCheck(id, {
          notificationId: notificationId,
        });
      }
    } catch (error) {
      logger.error("Failed to send new check notification");
    }

    // Try to embed text as a background operation if applicable
    if (type === "text" && text) {
      try {
        const embedderResult = await env.EMBEDDER_SERVICE.embed({
          text: text,
        });

        if (embedderResult.success) {
          const textEmbedding = (embedderResult as any).embedding || [];

          if (waitUntil) {
            waitUntil(
              env.DATABASE_SERVICE.updateCheck(id, {
                embeddings: {
                  text: textEmbedding,
                },
              }).catch((error) => {
                logger.error("Failed to update check");
                throw error;
              })
            );
          } else {
            await env.DATABASE_SERVICE.updateCheck(id, {
              embeddings: {
                text: textEmbedding,
              },
            });
          }

          logger.info({ id: id }, "Updated check record with embeddings");
        }
      } catch (error) {
        logger.error(
          { error, id: id },
          "Failed to embed text or update check record"
        );
      }
    }

    if (type === "image" && imageUrl && caption) {
      try {
        const embedderResult = await env.EMBEDDER_SERVICE.embed({
          text: caption,
        });

        if (embedderResult.success) {
          const captionEmbedding = (embedderResult as any).embedding || [];

          if (waitUntil) {
            waitUntil(
              env.DATABASE_SERVICE.updateCheck(id, {
                "embeddings.caption": captionEmbedding,
              }).catch((error) => {
                logger.error("Failed to update check");
                throw error;
              })
            );
          } else {
            await env.DATABASE_SERVICE.updateCheck(id, {
              "embeddings.caption": captionEmbedding,
            });
          }

          logger.info(
            { id: id },
            "Updated check record with caption embeddings"
          );
        }
      } catch (error) {
        logger.error(
          { error, id: id },
          "Failed to embed caption or update check record"
        );
      }
    }

    return {
      success: true,
      result: {
        checkId: id,
        notificationId: notificationId,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    logger.error({ error, id: id }, "Failed to create check record");
    return {
      success: false,
      error: {
        message: `Error creating check: ${errorMessage}`,
        code: "CREATE_CHECK_ERROR",
        details: error,
      },
    };
  }
}
