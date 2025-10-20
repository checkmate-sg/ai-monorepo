import { Experimental_Agent as Agent, ModelMessage, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { getAgentSystemPrompt } from "../prompts/agent";
import { createUrlScreenshotTool } from "../tools/url-screenshot";
import { createScanUrlTool } from "../tools/scan-url";
import { createReviewReportTool } from "../tools/review-report";
import { createSearchGoogleTool } from "../tools/search-google";
import { createLogger } from "@workspace/shared-utils";
import { CheckContext } from "../types";

/**
 * Transforms messages to inject screenshot images as user messages
 * so the AI model can properly "see" them instead of treating them as opaque base64 text
 */
function transformScreenshotMessages(messages: ModelMessage[]): ModelMessage[] {
  const transformed: ModelMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    transformed.push(msg);

    // Check if this is a tool-result message for url_screenshot
    if (
      msg.role === "tool" &&
      Array.isArray(msg.content) &&
      msg.content.some(
        (c: any) =>
          c.type === "tool-result" &&
          c.toolName === "url_screenshot" &&
          c.output?.value?.success === true &&
          (c.output?.value?.imageUrl || c.output?.value?.base64)
      )
    ) {
      // Find the specific tool-result content
      const toolResultContent = msg.content.find(
        (c: any) =>
          c.type === "tool-result" &&
          c.toolName === "url_screenshot" &&
          c.output?.value?.success === true &&
          (c.output?.value?.imageUrl || c.output?.value?.base64)
      ) as any;

      if (toolResultContent) {
        const { url, base64 } = toolResultContent.output.value;

        // Modify the tool result to simplify it
        toolResultContent.output = {
          type: "json",
          value: {
            success: true,
            imageContent: "Screenshot injected as user message below",
          },
        };
        // Inject a user message with the actual image
        transformed.push({
          role: "user",
          content: [
            { type: "text", text: `Screenshot of ${url}` },
            { type: "image", image: base64 },
          ],
        } as any);
      }
    }
  }

  return transformed;
}

export interface AgentLoopResult {
  report: string;
  sources: string[];
  isControversial: boolean;
}

export interface AgentLoopInputs {
  startingMessages: ModelMessage[];
  intent: string;
  maxSearches?: number;
  maxScreenshots?: number;
  maxSteps?: number;
}

export async function runAgentLoop(
  inputs: AgentLoopInputs,
  checkCtx: CheckContext,
  logger = createLogger("agent-loop")
): Promise<AgentLoopResult> {
  const {
    startingMessages,
    intent,
    maxSearches = 5,
    maxScreenshots = 5,
    maxSteps = 50,
  } = inputs;
  const env = checkCtx.env;
  let searchesRemaining = maxSearches;
  let screenshotsRemaining = maxScreenshots;
  let urlScansRemaining = 5;
  let finalReport: AgentLoopResult | null = null;

  // Track messages for review tool (starts with preprocessing messages)
  let currentMessages: ModelMessage[] = [...startingMessages];

  // Create tool instances
  const scanUrlTool = createScanUrlTool(checkCtx, {
    id: checkCtx.trace?.id || undefined,
  });
  const urlScreenshotTool = createUrlScreenshotTool(checkCtx, {
    screenshotsRemaining,
  });
  const searchGoogleTool = createSearchGoogleTool(checkCtx, {
    id: checkCtx.trace?.id || undefined,
  });
  const reviewReportTool = createReviewReportTool({
    checkCtx,
    getMessages: () => currentMessages,
    getIntent: () => intent,
  });

  logger.info(
    {
      scanUrlTool: typeof scanUrlTool,
      searchGoogleTool: typeof searchGoogleTool,
      hasParameters: "parameters" in scanUrlTool,
    },
    "Tools created"
  );

  const google = createGoogleGenerativeAI({
    apiKey: env.GEMINI_API_KEY,
  });

  const openai = createOpenAI({
    apiKey: env.OPENAI_API_KEY,
  });

  const agent = new Agent({
    // model: google("gemini-2.5-flash"),
    model: openai("gpt-5-mini"),
    system: getAgentSystemPrompt({
      datetime: new Date().toISOString(),
      searchesRemaining,
      screenshotsRemaining,
      urlScansRemaining,
    }),
    tools: {
      scan_url: scanUrlTool,
      url_screenshot: urlScreenshotTool,
      search_google: searchGoogleTool,
      // url_context: google.tools.urlContext({}),
      review_report: reviewReportTool,
    },
    toolChoice: "required" as const,
    stopWhen: [
      stepCountIs(maxSteps), // Maximum steps failsafe
      () => finalReport !== null, // Stop when report passes review
    ],
    prepareStep: async ({ messages, stepNumber }) => {
      logger.info(
        {
          stepNumber,
          messageCount: messages?.length,
        },
        "Preparing agent step"
      );

      // Transform messages to inject screenshots as user messages
      let transformedMessages = messages;
      if (messages) {
        transformedMessages = transformScreenshotMessages(messages);
        currentMessages = transformedMessages;
      }

      // Dynamically control which tools are available based on remaining counts
      const activeTools: Array<
        "scan_url" | "search_google" | "review_report" | "url_screenshot"
      > = [];

      if (searchesRemaining > 0) {
        activeTools.push("search_google");
      }
      if (urlScansRemaining > 0) {
        activeTools.push("scan_url");
      }
      if (screenshotsRemaining > 0) {
        activeTools.push("url_screenshot");
      }
      // review_report is always available
      activeTools.push("review_report");

      return {
        activeTools,
        messages: transformedMessages,
      };
    },
    onStepFinish: ({ toolCalls, toolResults, text }) => {
      // Log full toolCalls to see what properties are available
      logger.info(
        {
          text,
          toolCalls: toolCalls?.map((tc) => ({
            toolName: tc.toolName,
            input: tc.input,
          })),
          searchesRemaining,
          urlScansRemaining,
          screenshotsRemaining,
        },
        `Agent step completed`
      );

      // Track tool usage and decrement counters
      toolCalls?.forEach((toolCall, index) => {
        if (toolCall.toolName === "search_google" && searchesRemaining > 0) {
          searchesRemaining--;
          logger.info(
            { searchesRemaining },
            "Google search used, decremented counter"
          );
        } else if (
          toolCall.toolName === "url_screenshot" &&
          screenshotsRemaining > 0
        ) {
          screenshotsRemaining--;
          logger.info(
            { screenshotsRemaining },
            "URL screenshot used, decremented counter"
          );
        } else if (toolCall.toolName === "scan_url" && urlScansRemaining > 0) {
          urlScansRemaining--;
          logger.info(
            { urlScansRemaining },
            "URL scan used, decremented counter"
          );
        } else if (toolCall.toolName === "review_report") {
          // Extract the final report from the tool result
          const toolResult = toolResults?.[index];
          const result = toolResult?.output as any;
          if (result?.passedReview) {
            finalReport = {
              report: result.report,
              sources: result.sources,
              isControversial: result.isControversial,
            };
            logger.info(
              { finalReport },
              "Report passed review, ending agent loop"
            );
          } else {
            logger.info(
              { feedback: result?.feedback },
              "Report did not pass review, continuing"
            );
          }
        }
      });
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: "agent-loop",
      metadata: {
        langfuseTraceId: checkCtx.trace?.id ?? "",
        langfuseUpdateParent: false,
      },
    },
  });

  const result = await agent.generate({
    messages: startingMessages,
  });

  logger.info({ result }, "Agent loop completed");

  if (!finalReport) {
    throw new Error("Agent did not submit a final report");
  }

  return finalReport;
}
