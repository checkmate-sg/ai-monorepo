import type { Logger } from "pino";
import type { ReviewResult } from "../types";

export interface ToolContext {
  logger: Logger;
  id: string;
  env: Env;
  searchesRemaining: number;
  screenshotsRemaining: number;
  decrementSearches: () => void;
  decrementScreenshots: () => void;
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
