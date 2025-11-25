import { URLScanResult } from "@workspace/shared-types";
import { Tool } from "./types";
import { withLangfuseSpan } from "./utils";

export interface CheckMaliciousUrlParams {
  url: string;
}

export const checkMaliciousUrlTool: Tool<
  CheckMaliciousUrlParams,
  URLScanResult
> = {
  definition: {
    type: "function",
    function: {
      name: "check_malicious_url",
      description:
        "Scan a URL using Cloudflare Radar to check if it's malicious, contains phishing, or has security risks. Returns verdict with malicious flag, categories, and tags. Use only if there is reason to suspect the URL is malicious.",

      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "The URL of the website to check whether it is malicious.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  execute: withLangfuseSpan<CheckMaliciousUrlParams, URLScanResult>(
    "check-malicious-url",
    async (params, context, span) => {
      context.logger.info({ url: params.url }, "Executing urlscan tool");

      return await context.env.URLSCAN_SERVICE.urlScan({
        url: params.url,
        id: context.getId(),
      });
    }
  ),
};
