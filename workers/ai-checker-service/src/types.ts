// Local types for ai-checker-service

export interface CheckerServiceRequest {
  content: string;
  imageUrl?: string;
  caption?: string;
  languageHint?: string;
}

export interface CheckerServiceResponse {
  intent: string;
  title: string;
  canBeAssessed: boolean;
  isAccessBlocked: boolean;
  isVideo: boolean;
  report: string;
  summary: string;
  translation: string;
  sources: string[];
  isControversial: boolean;
}

// Service bindings (will be defined in wrangler.toml)
export interface Env {
  // Service bindings
  SEARCH_SERVICE?: any; // TODO: Define proper type from search-service
  SCREENSHOT_SERVICE?: any; // TODO: Define proper type from screenshot-service

  // Environment variables
  GEMINI_API_KEY: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_HOST?: string;
}
