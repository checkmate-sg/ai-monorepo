import { generateObject, ModelMessage } from "ai";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { z } from "zod";
import { getSummarizationSystemPrompt } from "../prompts/summarization";
import { createLogger } from "@workspace/shared-utils";
import { CheckContext } from "../types";
import { truncateBase64 } from "../utils/truncate-base64";

const SummarySchema = z.object({
  summary: z
    .string()
    .describe(
      "An X-style community note of around 50-100 words, following the style in the instructions."
    ),
});

export interface SummarizeReportInputs {
  startingMessages: ModelMessage[];
  intent: string;
  report: string;
}

export async function summarizeReport(
  options: SummarizeReportInputs,
  checkCtx: CheckContext
): Promise<string> {
  const childLogger = checkCtx.logger.child({ step: "summarize-report" });
  childLogger.info(truncateBase64({ options }), "Summarizing report");
  try {
    const { startingMessages, intent, report } = options;
    const env = checkCtx.env;
    const google = createGoogleGenerativeAI({
      apiKey: env.GEMINI_API_KEY,
    });

    // Extract content parts from startingMessages
    const contentParts = startingMessages.flatMap((msg: any) => {
      if (Array.isArray(msg.content)) {
        return msg.content;
      } else if (typeof msg.content === "string") {
        return [{ type: "text" as const, text: msg.content }];
      }
      return [];
    });

    const { object } = await (generateObject as any)({
      model: google("gemini-2.5-flash"),
      system: getSummarizationSystemPrompt(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `The following are the messages that were sent in to the user, and any screenshots of webpages that were taken.`,
            },
            ...contentParts,
            {
              type: "text",
              text: `The user's intent is to check the following: ${intent}`,
            },
            {
              type: "text",
              text: `The report is as follows: ${report}`,
            },
          ],
        },
      ],
      schema: SummarySchema,
      maxRetries: 2,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "summarize-report",
        metadata: {
          langfuseTraceId: checkCtx.trace?.id ?? "",
          langfuseUpdateParent: false,
        },
      },
    });
    return object.summary;
  } catch (error) {
    childLogger.error({ error }, "Error summarizing report");
    throw new Error(`Error summarizing report: ${error}`);
  }
}
