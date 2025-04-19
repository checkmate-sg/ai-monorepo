import { Tool } from "./types";
import type { ReviewResult } from "./types";
import { createClient } from "@workspace/shared-llm-client";
import { observeOpenAI } from "langfuse";
import { withLangfuseSpan } from "./utils";

export interface SubmitReportForReviewParams {
  report: string;
  sources: string[];
  is_controversial: boolean;
}

const configObject = {
  model: "o3-mini",
  reasoning_effort: "medium",
  temperature: 0,
  seed: 11,
  response_format: {
    type: "json_schema" as const,
    json_schema: {
      name: "review_report",
      strict: true,
      schema: {
        type: "object",
        properties: {
          feedback: {
            type: "string",
            description:
              "Your feedback on the report. Be concise and constructive.",
          },
          passedReview: {
            type: "boolean",
            description:
              "A boolean indicating whether the item passed the review",
          },
        },
        required: ["feedback", "passedReview"],
        additionalProperties: false,
      },
    },
  },
};

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
  execute: withLangfuseSpan<SubmitReportForReviewParams, ReviewResult>(
    "submit-report-for-review",
    async (params, context, span) => {
      const { model, provider } = context.getModelAndProvider();
      const client = await createClient(provider ?? "openai", context.env);

      try {
        const prompt = await context.langfuse.getPrompt(
          "review_report",
          undefined,
          {
            label:
              context.env.ENVIRONMENT === "production"
                ? "cf-production"
                : context.env.ENVIRONMENT, //TODO: revert after google version deprecated
            type: "chat",
          }
        );

        const observedClient = observeOpenAI(client, {
          clientInitParams: {
            publicKey: context.env.LANGFUSE_PUBLIC_KEY,
            secretKey: context.env.LANGFUSE_SECRET_KEY,
            baseUrl: context.env.LANGFUSE_HOST,
          },
          langfusePrompt: prompt,
          parent: span, // Set this span as parent
        });
        context.logger.info(params, "Executing submit report tool");

        // Format sources for the prompt
        const formattedSources =
          params.sources.length > 0
            ? "- " + params.sources.join("\n- ")
            : "<None>";

        // Compile the prompt with the report and formatted sources
        const config = prompt.config as typeof configObject;
        const messages = prompt.compile({
          intent: context.getIntent() || "<intent missing, proceed anyway>",
          report: params.report,
          formatted_sources: formattedSources,
        });

        // Make the API call to review the report
        const response = await observedClient.chat.completions.create({
          model: model || "gpt-4.1",
          temperature: config?.temperature || 0.0,
          seed: config?.seed || 11,
          response_format: config.response_format,
          messages: messages as any[],
        });

        // Parse the result - handle null case
        const content = response.choices[0].message.content || "{}";
        const result = JSON.parse(content);

        return {
          success: true,
          result: result,
        };
      } catch (error) {
        // Log the error
        context.logger.error(error, "Error in submit report tool");
        throw error;
      }
    }
  ),
};
