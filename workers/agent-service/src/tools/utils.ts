import type { ToolContext } from "./types";
import type { Langfuse } from "langfuse";
import { ScreenshotResult, LLMProvider } from "@workspace/shared-types";

// Updated decorator that passes the span to the function. Does the same as @observe in langfuse python sdk
export function withLangfuseSpan<T, R>(
  spanName: string,
  fn: (
    params: T,
    context: ToolContext,
    span: ReturnType<Langfuse["span"]>
  ) => Promise<R>
): (params: T, context: ToolContext) => Promise<R> {
  return async (params: T, context: ToolContext): Promise<R> => {
    const langfuse = context.langfuse;
    let span: ReturnType<Langfuse["span"]>;
    const parentSpan = context.getSpan();
    if (parentSpan) {
      span = parentSpan.span({
        name: spanName,
        input: params,
      });
    } else {
      span = langfuse.span({
        name: spanName,
        input: params,
        traceId: context.getTraceId(),
      });
    }
    try {
      const result = await fn(params, context, span);
      span.end({
        output: result,
        metadata: {
          success: true,
        },
      });
      return result;
    } catch (error) {
      span.end({
        metadata: {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  };
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
