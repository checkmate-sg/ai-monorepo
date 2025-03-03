/**
 * URLScan Service Worker
 *
 * This worker is responsible for checking if a URL is malicious
 */

import { URLScanRequest, URLScanResult } from "@workspace/shared-types";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("urlscan-service");
  private logContext: Record<string, any> = {};

  async fetch(request: Request): Promise<Response> {
    this.logger.info("Received fetch request");
    // transform request body to search request
    const body = (await request.json()) as any;
    body.id = request.headers.get("x-request-id");
    const urlScanRequest = body as URLScanRequest;
    const result = await this.urlScan(urlScanRequest);
    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async urlScan(request: URLScanRequest): Promise<URLScanResult> {
    this.logger.info("Received urlscan request");
    this.logContext = {
      request,
    };

    try {
      // call urlscan api
      this.logger.info(this.logContext, "Calling url scanning api");
      const url = `${this.env.URLSCAN_HOSTNAME}/evaluate`;
      const payload = {
        url: request.url,
        source: "checkmate",
      };
      const headers = {
        "x-api-key": this.env.URLSCAN_APIKEY,
        "Content-Type": "application/json",
        accept: "application/json",
        "User-Agent": "CheckMate",
      };

      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(payload),
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          {
            ...this.logContext,
            status: response.status,
            statusText: response.statusText,
            responseHeaders: Object.fromEntries([...response.headers]),
            errorText,
          },
          `URL Scanning API error: ${response.status}`
        );
        return {
          error: {
            message: `URL Scanning API returned ${response.status}: ${errorText}`,
          },
          id: request.id,
          success: false,
        };
      }

      // Parse the JSON response
      const data = (await response.json()) as any;

      // Check if we have immediate results
      if (
        data.success &&
        data.overall_result &&
        "classification" in data.overall_result &&
        "score" in data.overall_result
      ) {
        this.logger.info(
          { ...this.logContext, overallResult: data.overall_result },
          "Immediate results found, returning..."
        );
        return {
          success: true,
          result: {
            classification: data.overall_result.classification,
            score: data.overall_result.score,
          },
          id: request.id,
        };
      }

      // If no immediate results, get the request_id and poll
      const requestId = data.request_id;
      if (!requestId) {
        return {
          success: false,
          error: {
            message: data.message || "Request ID missing",
          },
          id: request.id,
        };
      }

      // Poll for results
      let overallResult = null;
      const maxAttempts = 15;
      let attempts = 0;

      while (!overallResult && attempts < maxAttempts) {
        attempts++;
        // Wait 1 second between polling attempts
        await new Promise((resolve) => setTimeout(resolve, 1000));

        this.logger.info(
          { ...this.logContext, requestId, attempt: attempts },
          "Polling for evaluation results"
        );

        const evaluationResponse = await fetch(
          `${this.env.URLSCAN_HOSTNAME}/url/${requestId}/evaluation`,
          { headers }
        );

        if (!evaluationResponse.ok) {
          const errorText = await evaluationResponse.text();
          this.logger.error(
            {
              ...this.logContext,
              status: evaluationResponse.status,
              statusText: evaluationResponse.statusText,
              errorText,
            },
            `Evaluation polling error: ${evaluationResponse.status}`
          );
          continue;
        }

        const evaluationResult = (await evaluationResponse.json()) as any;

        console.log(
          `Evaluation result: ${JSON.stringify(evaluationResult, null, 2)}`
        );

        if (
          evaluationResult &&
          evaluationResult.overall_result &&
          "classification" in evaluationResult.overall_result &&
          "score" in evaluationResult.overall_result
        ) {
          overallResult = evaluationResult.overall_result;
          break;
        }
      }

      if (overallResult) {
        this.logger.info(
          { ...this.logContext, overallResult },
          "Polling was successful, returning..."
        );
        return {
          success: true,
          result: {
            classification: overallResult.classification,
            score: overallResult.score,
          },
          id: request.id,
        };
      } else {
        this.logger.error(
          { ...this.logContext, overallResult },
          "Failed to get evaluation results after multiple attempts"
        );
        return {
          success: false,
          error: {
            message: "Failed to get evaluation results after multiple attempts",
          },
          id: request.id,
        };
      }
    } catch (error) {
      this.logger.error(
        { ...this.logContext, error },
        "Error processing urlscan request"
      );
      return {
        error: {
          message: `Failed to urlscan: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
        id: request.id,
        success: false,
      };
    }
  }
}
