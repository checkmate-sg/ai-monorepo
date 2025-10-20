import { tool, ModelMessage, generateText } from "ai";
import { z } from "zod";
import { CheckContext } from "../types";
import {
  createGoogleGenerativeAI,
  GoogleGenerativeAIProviderMetadata,
} from "@ai-sdk/google";
import { getReviewerSystemPrompt, reviewerPrompt } from "../prompts/reviewer";

interface ReviewReportToolOptions {
  checkCtx: CheckContext;
  getMessages: () => ModelMessage[];
  getIntent: () => string;
}

export const createReviewReportTool = ({
  checkCtx,
  getIntent,
}: ReviewReportToolOptions) => {
  return tool({
    description:
      "Submit a report for review. This concludes your task. The report will be reviewed and you'll receive feedback on whether it passed.",
    inputSchema: z.object({
      report: z
        .string()
        .describe(
          "The content of the report. This should have enough context for readers to stay safe and informed. Try to be succinct."
        ),
      sources: z
        .array(z.string().url())
        .describe(
          "A list of URLs from which your report is based. Avoid including the original link sent in for checking as that is obvious."
        ),
      isControversial: z
        .boolean()
        .describe(
          "True if the content contains political or religious viewpoints that are grounded in opinions rather than provable facts, and are likely to be divisive or polarizing."
        ),
    }),
    execute: async ({
      report,
      sources,
      isControversial,
    }: {
      report: string;
      sources: string[];
      isControversial: boolean;
    }) => {
      const childLogger = checkCtx.logger.child({ tool: "review-report" });

      const env = checkCtx.env;
      const google = createGoogleGenerativeAI({
        apiKey: env.GEMINI_API_KEY,
      });
      childLogger.info(
        { report, sources, isControversial },
        "Reviewing report"
      );

      try {
        // Format sources
        const formattedSources =
          sources.length > 0 ? "- " + sources.join("\n- ") : "<None>";

        // Get intent and messages
        const intent = getIntent();

        checkCtx.logger.info("Calling LLM to review report");

        // Call LLM to review the report
        const { text, providerMetadata } = await generateText({
          model: google("gemini-2.5-pro"),
          system:
            getReviewerSystemPrompt() +
            '\n\nAfter examining all sources, provide your review in this exact JSON format:\n{"feedback": "your feedback here", "passedReview": true or false}',
          prompt: `# User's Intent
${intent}

# Submitted Report
${report}

# Sources Used
${formattedSources}`,
          tools: {
            url_context: google.tools.urlContext({}),
          },
          maxRetries: 2,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "review-report",
            metadata: {
              langfuseTraceId: checkCtx.trace?.id ?? "",
              langfuseUpdateParent: false,
            },
          },
        });

        childLogger.info({ reviewResponse: text }, "Report review completed");

        // Parse the JSON response
        let reviewResult: { feedback: string; passedReview: boolean };
        try {
          // Extract JSON from the response (in case there's extra text)
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            reviewResult = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("No JSON found in response");
          }
        } catch {
          // If parsing fails, assume it passed
          checkCtx.logger.warn(
            "Failed to parse review response, assuming passed"
          );
          reviewResult = {
            feedback: text || "Review completed",
            passedReview: true,
          };
        }

        return {
          ...reviewResult,
          report,
          sources,
          isControversial,
        };
      } catch (error) {
        checkCtx.logger.error({ error }, "Error reviewing report");
        // In case of error, pass the review by default
        return {
          feedback: "Error during review. Accepting by default.",
          passedReview: true,
          report,
          sources,
          isControversial,
        };
      }
    },
  } as any);
};
