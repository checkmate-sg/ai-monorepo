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
        "Runs a check on the provided URL to determine if it is malicious. " +
        "Returns either 'MALICIOUS', 'SUSPICIOUS' or 'BENIGN', as well as a maliciousness " +
        "score from 0-1. Note, while a malicious rating should be trusted, a benign rating " +
        "doesn't imply the absence of malicious behaviour, as there might be false negatives.",
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
