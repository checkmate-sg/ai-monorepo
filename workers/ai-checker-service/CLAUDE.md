# AI Checker Service

A modernized version of the agent-service using Vercel AI SDK and Gemini.

## Architecture

This service replicates the agent-service flow but with modern tooling:

- **Vercel AI SDK** for LLM orchestration (instead of raw OpenAI SDK)
- **Gemini** as the primary provider (instead of GPT-4)
- **Same 4-step flow**: Preprocessing → Agent Loop → Summarization → Translation

## Core Flow (from agent-service)

### 1. Preprocessing (`preprocess-inputs.ts` pattern)

**Input**: Text or image with optional caption
**Process**:

- Extract URLs from text or image (OCR)
- Screenshot all URLs found
- Send to LLM with screenshots to determine:
  - Intent (what user wants to check)
  - canBeAssessed (sufficient info?)
  - isAccessBlocked (content behind login/paywall?)
  - isVideo (requires video viewing?)
  - title (short description <8 words)

**Output**: Structured preprocessing result + starting content array

### 2. Agent Loop (`agent.ts` agentLoop method)

**Input**: Starting content from preprocessing
**Process**:

- Use Vercel AI SDK's tool calling (instead of raw OpenAI tool calls)
- Agent has access to tools:
  - `google.tools.googleSearch({})` - Google search (max 5 searches)
  - `google.tools.urlContext({})` - Screenshot URLs (max 5 screenshots)
  - `scan_website_and_get_screenshot` - Take website screenshot
  - `submit_report_for_review` - Submit final report (exits loop)
- Loop until `submit_report_for_review` is called or max iterations
- Track searches/screenshots remaining, update system prompt each iteration

**Output**: Report (markdown), sources (URLs array), is_controversial (boolean)

### 3. Summarization (`summarise-report.ts` pattern)

**Input**: Full report from agent loop
**Process**: Use LLM to create concise summary (community note style)
**Output**: Short summary text

### 4. Translation (`translation.ts` pattern)

**Input**: Summary text
**Process**: Translate to Chinese
**Output**: Chinese translation

## Tool Implementation Pattern

```typescript
// Using Vercel AI SDK + Zod
import { tool } from "ai";
import { z } from "zod";

export const searchGoogleTool = tool({
  description: "Search Google for information",
  parameters: z.object({
    q: z.string().describe("Search query"),
  }),
  execute: async ({ q }, context) => {
    // Implementation
  },
});
```

## Agent Loop Pattern

### Agent construct

```typescript
import { Agent } from "ai";
import { google } from "@ai-sdk/google";

const agent = new Agent({
  model: google("gemini-2.0-flash"),
  system: ({ searchesRemaining, screenshotsRemaining }) =>
    `You are a fact checker. Searches remaining: ${searchesRemaining}. Screenshots remaining: ${screenshotsRemaining}`,
  tools: {
    search_google: searchGoogleTool,
    get_website_screenshot: screenshotTool,
    // ... other tools
  },
  maxSteps: 50,
});

const result = await agent.run({
  messages: startingContent,
  context: { searchesRemaining: 5, screenshotsRemaining: 5 },
});
```

**Pros**:

- Better state management (can update context like searches remaining)
- Dynamic system prompts based on state
- More control over agent behavior
- Built for agentic workflows
- Better observability

**Cons**: Slightly more complex setup

**Recommendation**: Use Agent construct since we need to:

- Update system prompt each iteration (searches/screenshots remaining)
- Track state across tool calls
- Have fine-grained control over the loop

## Dependencies

- `ai` - Vercel AI SDK
- `@ai-sdk/google` - Gemini provider
- `zod` - Schema validation for tools
- `langfuse` - Observability (same as agent-service)
- `@workspace/shared-utils` - Shared utilities
- `@workspace/shared-types` - Shared types
- `@workspace/shared-llm-client` - May not need if using Vercel AI SDK directly

## Environment Variables

Same as agent-service, plus:

- `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` for Gemini access
