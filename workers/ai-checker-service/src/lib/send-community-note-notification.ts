import {
  CommunityNote,
  ErrorResponse,
  ServiceResponse,
} from "@workspace/shared-types";
import { CheckContext } from "../types";

export interface SendCommunityNoteNotificationResult extends ServiceResponse {
  success: true;
  result: {
    communityNoteNotificationId: number | null;
  };
}

export type SendCommunityNoteNotificationResponse =
  | SendCommunityNoteNotificationResult
  | ErrorResponse;

interface SendCommunityNoteNotificationOptions {
  id: string;
  replyId: number | null;
  communityNote?: CommunityNote | null;
  isAccessBlocked?: boolean;
  isVideo?: boolean;
  isControversial?: boolean;
  isError?: boolean;
}

export async function sendCommunityNoteNotification(
  options: SendCommunityNoteNotificationOptions,
  checkCtx: CheckContext,
  waitUntil?: (promise: Promise<any>) => void
): Promise<SendCommunityNoteNotificationResponse> {
  const logger = checkCtx.logger.child({
    function: "sendCommunityNoteNotification",
  });
  const env = checkCtx.env;

  try {
    const notificationPayload = {
      id: options.id,
      replyId: options.replyId,
      communityNote: options.communityNote ?? null,
      ...(options.isAccessBlocked !== undefined && {
        isAccessBlocked: options.isAccessBlocked,
      }),
      ...(options.isVideo !== undefined && { isVideo: options.isVideo }),
      ...(options.isControversial !== undefined && {
        isControversial: options.isControversial,
      }),
      ...(options.isError !== undefined && { isError: options.isError }),
    };

    // If state is provided, run in background
    if (waitUntil && options.isError) {
      waitUntil(
        env.NOTIFICATION_SERVICE.sendCommunityNoteNotification(
          notificationPayload
        )
      );
      return {
        success: true,
        result: {
          communityNoteNotificationId: null,
        },
      };
    } else {
      // Otherwise await the notification
      const communityNoteNotificationId =
        await env.NOTIFICATION_SERVICE.sendCommunityNoteNotification(
          notificationPayload
        );
      return {
        success: true,
        result: {
          communityNoteNotificationId: communityNoteNotificationId,
        },
      };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    logger.error({ error }, "Failed to send community note notification");
    return {
      success: false,
      error: {
        message: `Error sending community note notification: ${errorMessage}`,
        code: "SEND_COMMUNITY_NOTE_NOTIFICATION_ERROR",
        details: error,
      },
    };
  }
}
