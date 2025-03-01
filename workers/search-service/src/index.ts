/**
 * Search Service Worker
 *
 * This worker is responsible for searching the web for information
 * It uses the Serper API to search the web
 *
 * @see https://serper.dev/
 */

import { SearchRequest, SearchResult } from "@workspace/shared-types";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";

export default class extends WorkerEntrypoint<{
  SERPER_API_KEY: string;
}> {
  private logger = createLogger("search-service");
  private logContext: Record<string, any> = {};

  async fetch(request: Request): Promise<Response> {
    this.logger.info("Received fetch request");
    // transform request body to search request
    const body = (await request.json()) as any;
    body.id = request.headers.get("x-request-id");
    const searchRequest = body as SearchRequest;
    const result = await this.search(searchRequest);
    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    this.logger.info("Received search request");
    this.logContext = {
      request,
    };

    try {
      // call serper api
      this.logger.info(this.logContext, "Calling serper api");
      const url = "https://google.serper.dev/search";
      const payload = {
        q: request.q,
        location: "Singapore",
        gl: "sg",
      };

      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "X-API-KEY": this.env.SERPER_API_KEY,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          this.logContext,
          `Serper API error: ${response.status} - ${errorText}`
        );
        throw new Error(`Search API returned ${response.status}: ${errorText}`);
      }

      // Parse the JSON response
      const data = (await response.json()) as any;

      // Return the organic results
      return {
        success: true,
        result: data.organic || [],
        id: request.id,
      };
    } catch (error) {
      this.logger.error(
        { ...this.logContext, error },
        "Error processing search request"
      );
      return {
        error: {
          message: `Failed to search: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
        id: request.id,
        success: false,
      };
    }
  }
}
