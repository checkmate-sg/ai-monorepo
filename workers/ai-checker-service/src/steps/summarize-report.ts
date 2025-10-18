import { generateObject } from "ai";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { z } from "zod";
import { getSummarizationSystemPrompt } from "../prompts/summarization";
import { createLogger } from "@workspace/shared-utils";

const SummarySchema = z.object({
  summary: z.string().describe("Concise 2-3 sentence summary of the report"),
});

export interface SummarizeReportOptions {
  report: string;
}

export async function summarizeReport(
  options: SummarizeReportOptions,
  env: Env,
  logger = createLogger("summarize-report")
): Promise<string> {
  const { report } = options;

  const { object } = await (generateObject as any)({
    google: createGoogleGenerativeAI({
      apiKey: env.GEMINI_API_KEY,
    }),
    system: getSummarizationSystemPrompt(),
    prompt: `Create a concise summary of this fact-checking report:

${report}`,
    schema: SummarySchema,
  });

  return object.summary;
}
