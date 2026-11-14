import type { ToolContext } from "./types";
import { withSpan, type LangfuseSpan } from "@workspace/shared-langfuse";
import { ScreenshotResult, LLMProvider } from "@workspace/shared-types";

// Timeout utility for LLM calls
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

// Wraps a tool in a Langfuse span under the active observation. Does the same as @observe in langfuse python sdk
export function withLangfuseSpan<T, R>(
  spanName: string,
  fn: (params: T, context: ToolContext, span: LangfuseSpan) => Promise<R>
): (params: T, context: ToolContext) => Promise<R> {
  return (params: T, context: ToolContext): Promise<R> =>
    withSpan(spanName, params, (span) => fn(params, context, span));
}
type EnhancedScreenshotResult = ScreenshotResult & { url?: string };

export function getOpenAIContent(screenshots: EnhancedScreenshotResult[]) {
  const content: any[] = [];

  for (const screenshot of screenshots) {
    if (screenshot.success && screenshot.result.url) {
      content.push({
        type: "text",
        text: `Screenshot of ${screenshot.url} below:`,
      });
      content.push({
        type: "image_url",
        image_url: { url: screenshot.result.imageUrl },
      });
    } else if (screenshot.success === false) {
      content.push({
        type: "text",
        text: `Blocked from/failed at getting screenshot of ${
          screenshot.url
        }: ${
          typeof screenshot.error === "string"
            ? screenshot.error
            : screenshot.error.message || JSON.stringify(screenshot.error)
        }`,
      });
    }
  }

  return content;
}
