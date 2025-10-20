import { ErrorResponse } from "@workspace/shared-types";
import {
  createLogger,
  hashUrl,
  arrayBufferToBase64,
} from "@workspace/shared-utils";
import { CheckContext } from "../types";

export interface DownloadImageOptions {
  imageUrl: string;
  id?: string;
}

export interface DownloadImageResponse {
  success: true;
  result: {
    imageUrl: string;
    arrayBuffer: ArrayBuffer;
    base64: string;
  };
}

export type DownloadImageResult = DownloadImageResponse | ErrorResponse;

/**
 * Downloads an image from a URL and stores it in R2 if not already cached
 * @param options - imageUrl to download
 * @param env - Cloudflare environment with R2 bindings
 * @returns ArrayBuffer and base64 of the image
 */
export async function downloadImage(
  options: DownloadImageOptions,
  checkCtx: CheckContext,
  logger = createLogger("download-image")
): Promise<DownloadImageResult> {
  const childLogger = logger.child({ step: "download-image" });
  const { imageUrl, id } = options;
  const env = checkCtx.env;
  try {
    let r2Key: string;

    // Check if URL is from cloudflare - extract filename
    if (
      imageUrl.startsWith("https://checkmate-images") &&
      imageUrl.includes("r2.cloudflarestorage.com")
    ) {
      const url = new URL(imageUrl);
      const filename = url.pathname.split("/").pop() || "";
      //check if filename exists in R2
      const r2Object = await env.CHECKMATE_IMAGES_BUCKET.get(filename);
      if (r2Object !== null) {
        childLogger.info({ filename }, "Image found in R2 cache");
        // Convert to base64 and return immediately
        const arrayBuffer = await r2Object.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        return {
          success: true,
          result: {
            imageUrl,
            arrayBuffer,
            base64,
          },
        };
      } else {
        r2Key = filename;
      }
    } else {
      // Hash the URL to create a unique R2 key
      const urlHash = await hashUrl(imageUrl);
      r2Key = urlHash;
      childLogger.info({ urlHash }, "Using hash as R2 key");
    }

    // Check if already cached in R2
    let r2Object = await env.CHECKMATE_IMAGES_BUCKET.get(r2Key);
    let arrayBuffer: ArrayBuffer;

    if (r2Object === null) {
      // Download the image
      childLogger.info({ imageUrl }, "Downloading image from URL");
      const response = await fetch(imageUrl);

      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType?.startsWith("image/")) {
        throw new Error(`URL does not point to an image: ${contentType}`);
      }

      arrayBuffer = await response.arrayBuffer();

      // Store in R2
      await env.CHECKMATE_IMAGES_BUCKET.put(r2Key, arrayBuffer);

      childLogger.info(
        { imageUrl, r2Key },
        "Image downloaded and stored in R2"
      );
    } else {
      childLogger.info({ imageUrl, r2Key }, "Image found in R2 cache");
      arrayBuffer = await r2Object.arrayBuffer();
    }

    // Convert to base64
    const base64 = arrayBufferToBase64(arrayBuffer);

    return {
      success: true,
      result: {
        imageUrl,
        arrayBuffer,
        base64,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    childLogger.error(
      { error, errorMessage, imageUrl },
      "Error downloading image"
    );

    return {
      success: false,
      error: {
        message: errorMessage,
      },
    };
  }
}
