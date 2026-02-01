import {
  CommunityNote,
  ErrorResponse,
  Report,
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
  longformReport?: Report | null;
  communityNote: CommunityNote | null;
}

export async function triggerVoting(
  options: TriggerVotingInputs,
  checkCtx: CheckContext,
  waitUntil?: (promise: Promise<any>) => void
): Promise<TriggerVotingResponse> {
  const logger = checkCtx.logger.child({ function: "triggerVoting" });
  const env = checkCtx.env;

  try {
    const response = await env.CHECKERS_WEBHOOK_SERVICE.fetch(
      new Request("https://internal/polls/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.CHECKERS_APP_API_KEY,
        },
        body: JSON.stringify({
          checkId: options.id,
          text: options.text ?? null,
          imageUrl: options.imageUrl ?? null,
          caption: options.caption ?? null,
          longformResponse: options.longformReport,
          shortformResponse: options.communityNote,
        }),
      })
    );

    let pollId: string | null = null;

    if (response.status === 409) {
      const result = (await response.json()) as { id?: string };
      pollId = result.id ?? null;
      logger.warn(
        { checkId: options.id, existingPollId: pollId },
        "Poll already exists for this check"
      );
    } else if (!response.ok) {
      const error = await response.json();
      throw new Error(`Webhook failed: ${JSON.stringify(error)}`);
    } else {
      const result = (await response.json()) as { id?: string };
      pollId = result.id ?? null;
    }

    // Update check with isVoteTriggered: true and pollId
    await updateCheck(
      options.id,
      {
        isVoteTriggered: true,
        pollId,
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
