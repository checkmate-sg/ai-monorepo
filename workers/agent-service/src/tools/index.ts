import { searchGoogleTool, type SearchGoogleParams } from "./search-google";
import {
  websiteScreenshotTool,
  type ScreenshotParams,
} from "./get-website-screenshot";
import {
  checkMaliciousUrlTool,
  type CheckMaliciousUrlParams,
} from "./check-malicious-url";
import {
  submitReportForReviewTool,
  type SubmitReportForReviewParams,
} from "./submit-report-for-review";
import { ToolContext } from "./types";

export type { ToolContext } from "./types";

export const createTools = (context: ToolContext) => {
  return {
    search_google: {
      definition: searchGoogleTool.definition,
      execute: (params: SearchGoogleParams) =>
        searchGoogleTool.execute({ q: params.q }, context),
    },
    get_website_screenshot: {
      definition: websiteScreenshotTool.definition,
      execute: (params: ScreenshotParams) =>
        websiteScreenshotTool.execute(params, context),
    },
    check_malicious_url: {
      definition: checkMaliciousUrlTool.definition,
      execute: (params: CheckMaliciousUrlParams) =>
        checkMaliciousUrlTool.execute(params, context),
    },
    submit_report_for_review: {
      definition: submitReportForReviewTool.definition,
      execute: (params: SubmitReportForReviewParams) =>
        submitReportForReviewTool.execute(params, context),
    },
  };
};
