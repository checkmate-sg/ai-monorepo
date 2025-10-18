import { Experimental_Agent as Agent, tool } from "ai";
import { google } from "@ai-sdk/google";
import { getAgentSystemPrompt } from "../prompts/agent";
import { searchGoogleTool } from "../tools/search-google";
import { urlScreenshotTool } from "../tools/url-screenshot";
import { submitReportTool } from "../tools/submit-report";
import { createLogger } from "@workspace/shared-utils";

export interface AgentLoopResult {
  report: string;
  sources: string[];
  isControversial: boolean;
}

export interface AgentLoopOptions {
  startingMessages: CoreMessage[];
  maxSearches?: number;
  maxScreenshots?: number;
  maxSteps?: number;
}

export async function runAgentLoop(
  options: AgentLoopOptions,
  env: Env,
  logger = createLogger("agent-loop")
): Promise<AgentLoopResult> {
  const {
    startingMessages,
    maxSearches = 5,
    maxScreenshots = 5,
    maxSteps = 50,
  } = options;

  let searchesRemaining = maxSearches;
  let screenshotsRemaining = maxScreenshots;
  let finalReport: AgentLoopResult | null = null;

  const agent = new Agent({
    model: google("gemini-2.0-flash-exp"),
    system: ({ searchesRemaining, screenshotsRemaining }) =>
      getAgentSystemPrompt({ searchesRemaining, screenshotsRemaining }),
    tools: {
      search_google: searchGoogleTool,
      get_url_screenshot: urlScreenshotTool,
      submit_report_for_review: submitReportTool,
    },
    maxSteps,
    onStepFinish: ({ toolResults }) => {
      // Update remaining counts based on tool usage
      toolResults?.forEach((toolResult) => {
        if (toolResult.toolName === "search_google") {
          searchesRemaining--;
        } else if (toolResult.toolName === "get_url_screenshot") {
          screenshotsRemaining--;
        } else if (toolResult.toolName === "submit_report_for_review") {
          finalReport = toolResult.result as AgentLoopResult;
        }
      });
    },
  });

  const result = await agent.generate({
    messages: startingMessages,
  });

  if (!finalReport) {
    throw new Error("Agent did not submit a final report");
  }

  return finalReport;
}
