/**
 * Search Service Worker
 *
 * This worker is responsible for checking if a URL is malicious
 */

import { URLScanRequest, URLScanResult } from "@workspace/shared-types";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";

export default class extends WorkerEntrypoint<{
  URLSCAN_APIKEY: string;
  URLSCAN_HOSTNAME: string;
}> {
  private logger = createLogger("search-service");
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
      // call serper api
      this.logger.info(this.logContext, "Calling url scanning api");
      const url = `${this.env.URLSCAN_HOSTNAME}/evaluate`; // hardcoded for now
      const payload = {
        url: request.url,
        source: "checkmate",
      };
      const headers = {
        "x-api-key": this.env.URLSCAN_APIKEY,
        "Content-Type": "application/json",
        accept: "application/json",
        "User-Agent": "CheckMate", // Match the exact User-Agent
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
        throw new Error(
          `URL Scanning API returned ${response.status}: ${errorText}`
        );
      }
      // Parse the JSON response
      const data = (await response.json()) as any;

      // Return the data
      return {
        success: true,
        result: data,
        id: request.id,
      };
    } catch (error) {
      this.logger.error(
        { ...this.logContext, error },
        "Error processing search request"
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
