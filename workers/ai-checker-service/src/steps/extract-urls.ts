import { generateObject } from "ai";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { z } from "zod";
import urlRegexSafe from "url-regex-safe";
import normalizeUrl from "normalize-url";
import { AgentRequest } from "@workspace/shared-types";
import { getUrlExtractionSystemPrompt } from "../prompts/url-extraction";
import { createLogger } from "@workspace/shared-utils";

const logger = createLogger("extract-urls");

export interface ExtractUrlsResponse {
  success: true;
  urls: string[];
}

export interface ExtractUrlsError {
  success: false;
  urls: [];
  error: string;
}

export type ExtractUrlsResult = ExtractUrlsResponse | ExtractUrlsError;

/**
 * Extracts URLs from text using regex pattern matching
 */
function extractUrlsFromText(text: string): string[] {
  const urlMatches = text.match(urlRegexSafe()) || [];
  return urlMatches.map((url) =>
    normalizeUrl(url, { defaultProtocol: "https", stripWWW: false })
  );
}

/**
 * Extracts URLs from image using Gemini vision OCR
 */
async function extractUrlsFromImage(
  imageUrl: string,
  imageBase64: string | undefined,
  env: Env
): Promise<string[]> {
  const google = createGoogleGenerativeAI({
    apiKey: env.GEMINI_API_KEY,
  });
  const model = google("gemini-2.5-flash");

  const { object } = await (generateObject as any)({
    model: model,
    system: getUrlExtractionSystemPrompt(),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: imageBase64 ?? imageUrl,
          },
        ],
      },
    ],
    schema: z.object({
      urls: z
        .array(z.string())
        .describe(
          "Array of URLs extracted from the image. Each URL should be a valid URL string."
        ),
    }),
  });

  const urls = (object as { urls: string[] }).urls || [];

  // Normalize the extracted URLs
  return urls
    .map((url) => {
      try {
        return normalizeUrl(url, {
          defaultProtocol: "https",
          stripWWW: false,
        });
      } catch (e) {
        // If normalization fails, return the original URL
        return url;
      }
    })
    .filter((url) => url.length > 0);
}

/**
 * Extracts URLs from text, image, or both
 * @param options - AgentRequest containing text or imageUrl with optional caption
 * @returns Array of normalized URLs
 */
export async function extractUrls(
  options: AgentRequest,
  env: Env,
  logger = createLogger("extract-urls")
): Promise<ExtractUrlsResult> {
  const childLogger = logger.child({ step: "extract-urls" });
  try {
    let urls: string[] = [];

    // Extract URLs from text if provided
    if ("text" in options && options.text) {
      const textUrls = extractUrlsFromText(options.text);
      urls = [...urls, ...textUrls];
    }

    // Extract URLs from image if provided
    if ("imageUrl" in options && options.imageUrl) {
      // Extract URLs from caption if provided
      if (options.caption) {
        const captionUrls = extractUrlsFromText(options.caption);
        urls = [...urls, ...captionUrls];
      }

      // Extract URLs from image
      const imageUrls = await extractUrlsFromImage(
        options.imageUrl,
        options.imageBase64,
        env
      );
      urls = [...urls, ...imageUrls];
    }

    // Deduplicate URLs while preserving order
    const uniqueUrls = Array.from(new Set(urls));

    childLogger.info({ urls, uniqueUrls }, "Extracted URLs");

    return {
      success: true,
      urls: uniqueUrls,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    childLogger.error({ error, errorMessage }, "Error in extractUrls");
    return {
      success: false,
      error: errorMessage,
      urls: [],
    };
  }
}
