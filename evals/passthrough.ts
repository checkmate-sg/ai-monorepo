// passthrough.ts
import type { ApiProvider, ProviderOptions, ProviderResponse } from "promptfoo";

export default class PassthroughProvider implements ApiProvider {
  id(): string {
    return "passthrough";
  }

  async callApi(prompt: string, context?: any): Promise<ProviderResponse> {
    const vars = context?.vars || {};

    // Reconstruct the output object from frozen columns in your sheet

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

      const enText = vars.production_output;
      const firstChar = enText.trim().substring(0, 2);
      let broadCategory = "nothing";
      for (const [emoji, category] of Object.entries(emojiMap)) {
        if (firstChar.startsWith(emoji)) {
          broadCategory = category;
          break;
        }
      }

    return {
      output: {
        en: vars.production_output,
        isControversial: vars.production_is_controversial,
        isVideo: vars.production_is_video,
        isAccessBlocked: vars.production_is_access_blocked,
        broadCategory: broadCategory,
        numRetries: 0,
      },
    };
  }
}