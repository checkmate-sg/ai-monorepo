import { tool } from "ai";
import { z } from "zod";
import { CheckContext } from "../types";

interface ToolContext {
  id?: string;
}

export const createScanUrlTool = (
  checkCtx: CheckContext,
  context: ToolContext
) => {
  return tool({
    description:
      "Scan a URL using Cloudflare Radar to check if it's malicious, contains phishing, or has security risks. Returns verdict with malicious flag, categories, and tags. Use only if there is reason to suspect the URL is malicious.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL to scan for malicious content"),
    }),
    execute: async ({ url }: { url: string }) => {
      const childLogger = checkCtx.logger.child({ tool: "scan-url" });
      childLogger.info({ url }, "Scanning URL");
      // Call urlscan-service binding
      const env = checkCtx.env;
      const result = await env.URLSCAN_SERVICE.urlScan({
        url,
        id: context.id,
      });

      if (!result.success) {
        return {
          url,
          error: result.error.message,
          scanned: false,
        };
      }

      const verdict = result.result;

      childLogger.info({ verdict }, "URL scanned");

      return {
        url,
        isMalicious: verdict.malicious,
        categories: verdict.categories || [],
        tags: verdict.tags || [],
        hasVerdicts: verdict.hasVerdicts || false,
        scanned: true,
      };
    },
  } as any);
};
