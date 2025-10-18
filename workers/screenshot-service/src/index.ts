import * as screenshotone from "screenshotone-api-sdk";

// create API client
import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger, hashUrl } from "@workspace/shared-utils";
import { ScreenshotRequest, ScreenshotResult } from "@workspace/shared-types";
export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("screenshot-service");
  private logContext: Record<string, any> = {};

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as any;
    body.id = request.headers.get("x-request-id");
    const screenshotRequest = body as ScreenshotRequest;
    const result = await this.screenshot(screenshotRequest);
    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async screenshot(request: ScreenshotRequest): Promise<ScreenshotResult> {
    this.logger.info("Received screenshot request");
    this.logContext = { request };
    const { url, id } = request;

    if (!url) {
      this.logger.error(this.logContext, "Missing required 'url' field");
      return {
        success: false,
        error: { message: "Missing required 'url' field" },
        id,
      };
    }
    // Validate URL format
    try {
      new URL(url);
    } catch {
      return {
        success: false,
        error: { message: "Invalid URL format" },
        id,
      };
    }

    try {
      const urlHash = await hashUrl(url);
      const imageUrl = `${this.env.API_DOMAIN}/${urlHash}`;
      const r2Object = await this.env.SCREENSHOT_BUCKET.get(urlHash);

      let buffer: ArrayBuffer;

      if (r2Object === null) {
        const client = new screenshotone.Client(
          this.env.SCREENSHOT_ONE_ACCESS_KEY,
          this.env.SCREENSHOT_ONE_SECRET_KEY
        );

        // set up options
        const options = screenshotone.TakeOptions.url(url)
          .format("jpg")
          .blockAds(true)
          .blockCookieBanners(true)
          .blockBannersByHeuristics(false)
          .blockTrackers(true)
          .delay(3)
          .timeout(15)
          .ignoreHostErrors(true)
          .responseType("by_format")
          .fullPage(true)
          .fullPageScroll(true)
          .imageQuality(80);

        const blob = await client.take(options);
        buffer = await blob.arrayBuffer();

        await this.env.SCREENSHOT_BUCKET.put(urlHash, buffer, {
          httpMetadata: {
            contentType: "image/jpeg",
            cacheControl: "public, max-age=86400",
          },
        });
      } else {
        // Use cached screenshot
        buffer = await r2Object.arrayBuffer();
      }

      // Convert to base64 string
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

      return {
        success: true,
        result: {
          url: url,
          imageUrl: imageUrl,
          base64: base64,
        },
        id,
      };
    } catch (error) {
      this.logger.error({ error }, "Error taking screenshot", { error });
      return {
        success: false,
        error: { message: "Error taking screenshot" },
        id,
      };
    }
  }
}
