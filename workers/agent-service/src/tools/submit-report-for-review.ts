import { Tool, ToolContext } from "./types";
import type { ReviewResult } from "../types";

export interface SubmitReportForReviewParams {
  report: string;
  sources: string[];
  is_controversial: boolean;
}

export const submitReportForReviewTool: Tool<
  SubmitReportForReviewParams,
  ReviewResult
> = {
  definition: {
    type: "function",
    function: {
      name: "submit_report_for_review",
      description: "Submits a report, which concludes the task.",
      parameters: {
        type: "object",
        properties: {
          report: {
            type: "string",
            description:
              "The content of the report. This should enough context for readers to stay safe and informed. Try and be succinct.",
          },
          sources: {
            type: "array",
            items: {
              type: "string",
              description:
                "A link from which you sourced content for your report.",
            },
            description:
              "A list of links from which your report is based. Avoid including the original link sent in for checking as that is obvious.",
          },
          is_controversial: {
            type: "boolean",
            description:
              "True if the content contains political or religious viewpoints that are grounded in opinions rather than provable facts, and are likely to be divisive or polarizing.",
          },
        },
        required: ["report", "sources", "is_controversial"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  execute: async (
    params: SubmitReportForReviewParams,
    context: ToolContext
  ): Promise<ReviewResult> => {
    context.logger.info(params, "Executing submit report tool");

    return {
      success: true,
      result: {
        feedback: params.report,
        passedReview: params.is_controversial,
      },
    };
  },
};
