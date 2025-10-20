/**
 * URLScan Service Worker
 *
 * This worker is responsible for checking if a URL is malicious
 */

import { URLScanRequest, URLScanResult } from "@workspace/shared-types";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger, hashUrl } from "@workspace/shared-utils";

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("urlscan-service");
  private logContext: Record<string, any> = {};

  /**
   * Download and save screenshot to R2 bucket (non-blocking)
   */
  private async saveScreenshotToR2(
    url: string,
    scanUuid: string,
    baseUrl: string,
    authToken?: string,
    screenshotUrlFromResponse?: string
  ): Promise<string | null> {
    try {
      // Use screenshot URL from response if provided, otherwise construct it
      const screenshotUrl =
        screenshotUrlFromResponse ||
        (baseUrl.includes("/accounts/")
          ? `${baseUrl}/screenshots/${scanUuid}.png`
          : `https://api.cloudflare.com/client/v4/radar/url_scanner/scan/${scanUuid}/screenshot`);

      this.logger.info(
        { scanUuid, screenshotUrl },
        "Downloading screenshot from Cloudflare Radar"
      );

      // Fetch screenshot
      const screenshotResponse = await fetch(screenshotUrl, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });

      if (!screenshotResponse.ok) {
        this.logger.warn(
          { scanUuid, status: screenshotResponse.status },
          "Failed to download screenshot"
        );
        return null;
      }

      // Check content type
      const contentType = screenshotResponse.headers.get("content-type");
      this.logger.info(
        { scanUuid, contentType },
        "Screenshot content type received"
      );

      // Get image data
      const imageData = await screenshotResponse.arrayBuffer();

      // Hash the URL to generate R2 key
      const urlHash = await hashUrl(url);
      const r2Key = `scans/${urlHash}.png`;

      // Save to R2
      await this.env.SCREENSHOT_BUCKET.put(r2Key, imageData, {
        httpMetadata: {
          contentType: contentType || "image/png",
        },
        customMetadata: {
          scanUuid,
          originalUrl: url,
          uploadedAt: new Date().toISOString(),
        },
      });

      this.logger.info({ scanUuid, r2Key, urlHash }, "Screenshot saved to R2");

      return r2Key;
    } catch (error) {
      this.logger.error({ scanUuid, error }, "Error saving screenshot to R2");
      return null;
    }
  }

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
      // Build headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add authentication if API token is provided
      if (this.env.CLOUDFLARE_RADAR_API_TOKEN) {
        headers[
          "Authorization"
        ] = `Bearer ${this.env.CLOUDFLARE_RADAR_API_TOKEN}`;
      }

      // Determine API endpoint
      // Use account-specific endpoint if account ID is provided, otherwise use public radar endpoint
      const baseUrl = this.env.CLOUDFLARE_ACCOUNT_ID
        ? `https://api.cloudflare.com/client/v4/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/urlscanner/v2`
        : `https://api.cloudflare.com/client/v4/radar/url_scanner`;

      // Submit URL for scanning
      this.logger.info(this.logContext, "Submitting URL to Cloudflare Radar");
      const submitUrl = `${baseUrl}/scan`;
      const payload = {
        url: request.url,
        visibility: "unlisted",
      };

      const submitResponse = await fetch(submitUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        this.logger.error(
          {
            ...this.logContext,
            status: submitResponse.status,
            statusText: submitResponse.statusText,
            errorText,
          },
          `Cloudflare Radar API error: ${submitResponse.status}`
        );
        return {
          error: {
            message: `Cloudflare Radar API returned ${submitResponse.status}: ${errorText}`,
          },
          id: request.id,
          success: false,
        };
      }

      const submitData = (await submitResponse.json()) as any;
      // Extract scan UUID from response
      const scanUuid = submitData.uuid;
      const publicResultUrl = submitData.result;

      if (!scanUuid) {
        this.logger.error(
          { ...this.logContext, submitData },
          "No scan UUID returned from API"
        );
        return {
          success: false,
          error: {
            message: "No scan UUID returned from Cloudflare Radar API",
          },
          id: request.id,
        };
      }

      this.logger.info(
        { ...this.logContext, scanUuid, publicResultUrl },
        "URL scan submitted, polling for results"
      );

      // Poll for results (wait up to 30 seconds)
      const maxAttempts = 15;
      const delayMs = 2000; // 2 seconds between polls
      let attempts = 0;

      while (attempts < maxAttempts) {
        attempts++;

        // Wait before checking (except first attempt)
        if (attempts > 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        this.logger.info(
          { ...this.logContext, scanUuid, attempt: attempts },
          "Polling for scan results"
        );

        // Fetch scan results
        const resultUrl = `${baseUrl}/result/${scanUuid}`;
        const resultResponse = await fetch(resultUrl, {
          headers: this.env.CLOUDFLARE_RADAR_API_TOKEN
            ? { Authorization: `Bearer ${this.env.CLOUDFLARE_RADAR_API_TOKEN}` }
            : {},
        });

        if (!resultResponse.ok) {
          //log error text
          const errorText = await resultResponse.text();
          this.logger.warn(
            {
              ...this.logContext,
              status: resultResponse.status,
              attempt: attempts,
            },
            "Polling attempt failed, will retry"
          );
          continue; // Keep polling
        }

        const resultData = (await resultResponse.json()) as any;

        // Check if scan is complete
        const task = resultData.task;
        const taskSuccess = task?.success;

        if (taskSuccess === true) {
          const verdicts = resultData.verdicts?.overall;
          const isMalicious = verdicts?.malicious || false;
          const categories = verdicts?.categories || [];
          const tags = verdicts?.tags || [];
          const hasVerdicts = verdicts?.hasVerdicts || false;

          this.logger.info(
            {
              ...this.logContext,
              isMalicious,
              categories,
              tags,
              hasVerdicts,
              scanUrl: publicResultUrl,
            },
            "Scan completed successfully"
          );

          // Download and save screenshot to R2 in non-blocking way
          const urlHash = await hashUrl(request.url);
          const screenshotKey = `scans/${urlHash}.png`;

          // Use screenshot URL from response if available
          const screenshotUrl = task.screenshotURL;

          this.ctx.waitUntil(
            this.saveScreenshotToR2(
              request.url,
              scanUuid,
              baseUrl,
              this.env.CLOUDFLARE_RADAR_API_TOKEN,
              screenshotUrl
            )
          );

          return {
            success: true,
            result: {
              isMalicious,
              verdict: {
                categories,
                tags,
                hasVerdicts,
              },
            },
            id: request.id,
          };
        } else if (taskSuccess === false) {
          this.logger.error(
            { ...this.logContext, task, resultData },
            "Scan failed"
          );
          return {
            success: false,
            error: {
              message: "URL scan failed",
            },
            id: request.id,
          };
        }

        // Status is still "queued" or "processing", continue polling
      }

      // Timeout - return error with scan URL for manual review
      this.logger.warn(
        { ...this.logContext, scanUuid, publicResultUrl },
        "Scan timed out, returning scan URL for manual review"
      );
      return {
        success: false,
        error: {
          message: `Scan did not complete within timeout. Manual review: ${
            publicResultUrl || `https://radar.cloudflare.com/scan/${scanUuid}`
          }`,
        },
        id: request.id,
      };
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
