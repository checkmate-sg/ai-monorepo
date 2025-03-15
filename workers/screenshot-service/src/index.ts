import puppeteer from "@cloudflare/puppeteer";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";
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

    let browser;
    try {
      const urlHash = await hashUrl(url);
      const imageUrl = `${this.env.SCREENSHOT_API_DOMAIN}/${urlHash}`;
      const r2Object = await this.env.SCREENSHOT_BUCKET.get(urlHash);

      if (r2Object === null) {
        browser = await puppeteer.launch(this.env.BROWSER);
        const page = await browser.newPage();

        // Set viewport size
        await page.setViewport({ width: 1280, height: 800 });

        await page.goto(url, { waitUntil: "networkidle0", timeout: 10000 });

        const imageBuffer = (await page.screenshot({
          type: "png",
          fullPage: true,
        })) as Buffer;

        await this.env.SCREENSHOT_BUCKET.put(urlHash, imageBuffer, {
          httpMetadata: {
            contentType: "image/jpeg",
            cacheControl: "public, max-age=86400",
          },
        });
      }

      return {
        success: true,
        result: {
          url: url,
          imageUrl: imageUrl,
        },
        id,
      };
    } catch (error) {
      this.logger.error(this.logContext, "Error taking screenshot", { error });
      return {
        success: false,
        error: { message: "Error taking screenshot" },
        id,
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}

async function hashUrl(url: string): Promise<string> {
  // Normalize the URL by creating a URL object and getting its string representation
  const normalizedUrl = new URL(url).toString();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalizedUrl);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
