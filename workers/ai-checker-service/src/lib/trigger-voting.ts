import {
  CommunityNote,
  ErrorResponse,
  ServiceResponse,
} from "@workspace/shared-types";
import { CheckContext } from "../types";
import { updateCheck } from "./update-check";

export interface TriggerVotingResult extends ServiceResponse {
  success: true;
  result: {
    votingTriggered: boolean;
  };
}

export type TriggerVotingResponse = TriggerVotingResult | ErrorResponse;

interface TriggerVotingInputs {
  id: string;
  text?: string | null;
  imageUrl?: string | null;
  caption?: string | null;
  isAccessBlocked?: boolean;
  isVideo?: boolean;
  isControversial: boolean;
  generationStatus: string;
  communityNote: CommunityNote | null;
  title?: string | null;
  slug?: string | null;
  notificationId?: number | null;
  communityNoteNotificationId?: number | null;
}

export async function triggerVoting(
  options: TriggerVotingInputs,
  checkCtx: CheckContext,
  waitUntil?: (promise: Promise<any>) => void
): Promise<TriggerVotingResponse> {
  const logger = checkCtx.logger.child({ function: "triggerVoting" });
  const env = checkCtx.env;

  try {
    const response = await fetch(`${env.CHECKERS_APP_URL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.CHECKERS_APP_API_KEY,
      },
      body: JSON.stringify({
        id: options.id,
        machineCategory: "unsure",
        isMachineCategorised: false,
        imageUrl: options.imageUrl ?? null,
        text: options.text ?? null,
        caption: options.caption ?? null,
        isControversial: options.isControversial,
        communityNoteStatus: options.generationStatus,
        communityNote: options.communityNote,
        isCommunityNoteUsable:
          options.generationStatus === "completed" &&
          !options.isAccessBlocked &&
          !options.isVideo,
        isIrrelevant: false,
        title: options.title ?? null,
        slug: options.slug ?? null,
        messageNotificationId: options.notificationId ?? null,
        communityNoteNotificationId:
          options.communityNoteNotificationId ?? null,
      }),
    });

    // Consume the response body to free the connection
    if (response.ok) {
      await response.text();
    } else {
      response.body?.cancel();
    }

    // Update check with isVoteTriggered: true
    await updateCheck(
      options.id,
      {
        isVoteTriggered: true,
      },
      checkCtx,
      waitUntil
    );

    return {
      success: true,
      result: {
        votingTriggered: true,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    logger.error({ error }, "Voting failed to trigger");
    return {
      success: false,
      error: {
        message: `Error triggering voting: ${errorMessage}`,
        code: "TRIGGER_VOTING_ERROR",
        details: error,
      },
    };
  }
}
