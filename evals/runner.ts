import type { ApiProvider, ProviderOptions, ProviderResponse } from "promptfoo";

interface ProviderConfig {
  method?: string;
  maxRetries?: number;
  retryDelay?: number;
}

export default class CustomApiProvider implements ApiProvider {
  protected providerId: string;
  public config: ProviderConfig;

  constructor(options: ProviderOptions) {
    this.providerId = options.id || "custom-checkmate-api";
    this.config = options.config as ProviderConfig;

    // Set default retry config
    if (this.config.maxRetries === undefined) {
      this.config.maxRetries = 3;
    }
    if (this.config.retryDelay === undefined) {
      this.config.retryDelay = 1000; // 1 second
    }
  }

  id(): string {
    return this.providerId;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async callApi(prompt: string, context?: any): Promise<ProviderResponse> {
    const maxRetries = this.config.maxRetries!;
    const retryDelay = this.config.retryDelay!;
    const vars = context?.vars || {};

    // Build request from env vars and context
    const url = `${process.env.ML_SERVER_URL}/getAgentResult`;
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": process.env.ML_SERVER_API_KEY || "",
    };

    // Only include non-null fields
    const body: any = { findSimilar: false };
    if (vars.input_text) body.text = vars.input_text;
    if (vars.input_image_url) body.imageUrl = vars.input_image_url;
    if (vars.input_caption) body.caption = vars.input_caption;

    console.log(url, headers, body);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `[Attempt ${attempt + 1}/${maxRetries + 1}] Calling ${url}`
        );

        // Make the API call
        const response = await fetch(url, {
          method: this.config.method || "POST",
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Error Response] ${response.status}: ${errorText}`);
          throw new Error(
            `HTTP error! status: ${response.status} ${response.statusText} - ${errorText}`
          );
        }

        const json = (await response.json()) as any;
        console.log(`[Success] Request completed on attempt ${attempt + 1}`);

        // Extract emoji category from community note
        const emojiMap: Record<string, string> = {
          "🚨": "bad",
          "❌": "bad",
          "✅": "good",
          "🟢": "good",
          "⚠️": "caution",
          "❗": "caution",
          "❓": "caution",
          "🎭": "satire",
          "📝": "nothing",
        };

        const enText = json.result.communityNote.en || "";
        const firstChar = enText.trim().substring(0, 2);
        let broadCategory = "unknown";
        for (const [emoji, category] of Object.entries(emojiMap)) {
          if (firstChar.startsWith(emoji)) {
            broadCategory = category;
            break;
          }
        }

        return {
          output: {
            en: json.result.communityNote.en,
            cn: json.result.communityNote.cn,
            links: json.result.communityNote.links,
            isControversial: json.result.isControversial ? "TRUE" : "FALSE",
            isVideo: json.result.isVideo ? "TRUE" : "FALSE",
            isAccessBlocked: json.result.isAccessBlocked ? "TRUE" : "FALSE",
            broadCategory,
            numRetries: attempt,
          },
          raw: json,
        };
      } catch (error) {
        lastError = error as Error;
        console.error(
          `[Attempt ${attempt + 1}/${maxRetries + 1}] Failed: ${
            lastError.message
          }`
        );

        if (attempt < maxRetries) {
          console.log(`[Retry] Waiting ${retryDelay}ms before retry...`);
          await this.sleep(retryDelay);
          continue;
        }
      }
    }

    // All retries failed
    console.error(`[Failed] All ${maxRetries + 1} attempts failed`);
    return {
      error: `Failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
    };
  }
}
