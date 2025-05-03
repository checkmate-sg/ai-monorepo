import type { Logger } from "pino";
import type { Langfuse } from "langfuse";
import type { LLMProvider } from "@workspace/shared-types";
export interface ToolContext {
  logger: Logger;
  getId: () => string;
  getTraceId: () => string;
  env: Env;
  // For search-google and get-website-screenshot
  getSearchesRemaining: () => number;
  getScreenshotsRemaining: () => number;
  decrementSearches: () => void;
  decrementScreenshots: () => void;
  // For submit-report-for-review
  getImageUrl: () => string | undefined;
  getCaption: () => string | undefined;
  getText: () => string | undefined;
  getIntent: () => string | undefined;
  getType: () => "text" | "image" | undefined;
  langfuse: Langfuse;
  getSpan: () => ReturnType<Langfuse["span"]> | undefined;
  getModelAndProvider: () => {
    model: string | undefined;
    provider: LLMProvider | undefined;
  };
}

export interface Tool<P, R> {
  definition: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: string;
        properties: Record<string, any>;
        required: string[];
        additionalProperties: boolean;
      };
      strict: boolean;
    };
  };
  execute: (params: P, context: ToolContext) => Promise<R>;
}

export interface ReviewResponse {
  success: true;
  result: {
    feedback: string;
    passedReview: boolean;
  };
}

export interface ErrorResponse {
  success: false;
  error: {
    message: string;
  };
}

export interface TranslateTextResponse {
  success: true;
  result: {
    language: string;
    translatedText: string;
  };
}

export interface SummariseReportResponse {
  success: true;
  result: {
    summary: string;
  };
}

export interface ExtractImageUrlsResponse {
  success: true;
  result: {
    imageUrls: string[];
  };
}

export type SummariseReportResult = SummariseReportResponse | ErrorResponse;

export type TranslateTextResult = TranslateTextResponse | ErrorResponse;

export type ExtractImageUrlsResult = ExtractImageUrlsResponse | ErrorResponse;

export type ReviewResult = ReviewResponse | ErrorResponse;

export interface PreprocessResponse {
  success: true;
  result: {
    isAccessBlocked: boolean;
    isVideo: boolean;
    intent: string;
    startingContent: any[];
    title: string | null;
  };
}

export type PreprocessResult = PreprocessResponse | ErrorResponse;
