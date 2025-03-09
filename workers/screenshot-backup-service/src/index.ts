import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";
import { ScreenshotRequest, ScreenshotResult } from "@workspace/shared-types";
import { getGoogleIdToken } from "@workspace/shared-utils";

interface ScreenshotAPIResponse {
  success: boolean;
  result: string;
}

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("screenshot-backup-service");
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
      const token = await getGoogleIdToken(
        this.env.GOOGLE_CLIENT_ID,
        this.env.GOOGLE_CLIENT_SECRET,
        this.env.SCREENSHOT_API_ENDPOINT
      );
      const response = await fetch(
        `${this.env.SCREENSHOT_API_ENDPOINT}/get-screenshot`,
        {
          method: "POST",
          body: JSON.stringify({ url }),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = (await response.json()) as ScreenshotAPIResponse;

      const imageUrl = data.result;

      if (!imageUrl) {
        this.logger.error(this.logContext, "No image URL returned");
        return {
          success: false,
          error: { message: "No image URL returned" },
          id,
        };
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
      this.logger.error(
        { ...this.logContext, error },
        "Error taking screenshot"
      );
      return {
        success: false,
        error: { message: "Error taking screenshot" },
        id,
      };
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
