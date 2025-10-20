import { AgentResult, Check } from "@workspace/shared-types";
import { CheckContext } from "../types";

export async function getCheck(
  id: string,
  checkCtx: CheckContext
): Promise<AgentResult> {
  const logger = checkCtx.logger.child({ step: "get-check" });
  checkCtx.logger = logger;
  logger.info({ id }, "Getting check");
  const check = (await checkCtx.env.DATABASE_SERVICE.findCheckById(id))
    .data as Check;
  if (!check) {
    return {
      success: false,
      error: {
        message: "Check not found",
      },
    };
  } else {
    logger.info({ check }, "Found check");
    if (!check.longformResponse.timestamp) {
      check.longformResponse.timestamp = check.timestamp;
    }
    if (!check.shortformResponse.timestamp) {
      check.shortformResponse.timestamp = check.timestamp;
    }
    return {
      success: true,
      id: check._id,
      result: {
        report: check.longformResponse,
        generationStatus: check.generationStatus,
        communityNote: check.shortformResponse,
        humanNote: check.humanResponse,
        isControversial: check.isControversial,
        text: check.text,
        imageUrl: check.imageUrl,
        caption: check.caption,
        isVideo: check.isVideo,
        isAccessBlocked: check.isAccessBlocked,
        title: check.title,
        slug: check.slug,
        timestamp: check.timestamp,
        crowdsourcedCategory: check.crowdsourcedCategory,
        isHumanAssessed: check.isHumanAssessed,
        isVoteTriggered: check.isVoteTriggered,
      },
    };
  }
}
