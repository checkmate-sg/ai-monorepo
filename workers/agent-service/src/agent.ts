import { DurableObject } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";
import { Logger } from "pino";
import OpenAI from "openai";
import { createClient } from "./client";
import {
  AgentRequest,
  SearchResult,
  ScreenshotResult,
  URLScanResult,
} from "@workspace/shared-types";
import type { ReviewResult } from "./types";
import type { ChatCompletionMessageToolCall } from "openai/resources";

const logger = createLogger("agent");

export class CheckerAgent extends DurableObject<Env> {
  private logger: Logger;
  private searchesRemaining: number;
  private screenshotsRemaining: number;
  private id: string;
  private totalCost: number;
  private client?: OpenAI;
  private intent?: string;
  private imageUrl?: string;
  private caption?: string;
  private text?: string;
  private totalTime?: number;
  private type?: "text" | "image";
  /**
   * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
   * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
   *
   * @param ctx - The interface for interacting with Durable Object state
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   */

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.searchesRemaining = 5;
    this.screenshotsRemaining = 5;
    if (ctx.id.name) {
      this.id = ctx.id.name;
    } else {
      this.id = crypto.randomUUID();
      logger.warn({ id: this.id }, "Agent created with random ID");
    }
    this.logger = logger.child({
      id: ctx.id.name,
    });
    this.logger.info("Agent created");
    this.totalCost = 0;
    this.totalTime = 0;
  }

  private tools = {
    search_google: {
      definition: {
        type: "function",
        function: {
          name: "search_google",
          description:
            "Searches Google for the given query and returns organic search results using serper.dev. Call this when you need to retrieve information from Google search results.",
          parameters: {
            type: "object", // Use lowercase "object" in JSON Schema
            properties: {
              q: {
                type: "string", // Use lowercase "string" in JSON Schema
                description: "The search query to use on Google.",
              },
            },
            required: ["q"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
      execute: async (params: { query: string }): Promise<SearchResult> => {
        if (this.searchesRemaining <= 0) {
          throw new Error("Search limit reached");
        }

        this.logger.info({ query: params.query }, "Executing search tool");
        this.searchesRemaining--;

        return await this.env.SEARCH_SERVICE.search({
          q: params.query,
          id: this.id,
        });
      },
    },
    get_website_screenshot: {
      definition: {
        type: "function",
        function: {
          name: "get_website_screenshot",
          description:
            "Takes a screenshot of the url provided. Call this when you need to look at the web page.",
          parameters: {
            type: "object", // Use lowercase "object" in JSON Schema
            properties: {
              url: {
                type: "string", // Use lowercase "string" in JSON Schema
                description: "The URL of the website to take a screenshot of.",
              },
            },
            required: ["url"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
      execute: async (params: { url: string }): Promise<ScreenshotResult> => {
        if (this.screenshotsRemaining <= 0) {
          throw new Error("Screenshot limit reached");
        }

        this.logger.info({ url: params.url }, "Executing screenshot tool");
        this.screenshotsRemaining--;

        return await this.env.SCREENSHOT_SERVICE.screenshot({
          url: params.url,
          id: this.id,
        });
      },
    },
    check_malicious_url: {
      definition: {
        type: "function",
        function: {
          name: "check_malicious_url",
          description:
            "Runs a check on the provided URL to determine if it is malicious. " +
            "Returns either 'MALICIOUS', 'SUSPICIOUS' or 'BENIGN', as well as a maliciousness " +
            "score from 0-1. Note, while a malicious rating should be trusted, a benign rating " +
            "doesn't imply the absence of malicious behaviour, as there might be false negatives.",
          parameters: {
            type: "object", // Use lowercase "object" in JSON Schema
            properties: {
              url: {
                type: "string", // Use lowercase "string" in JSON Schema
                description:
                  "The URL of the website to check whether it is malicious.",
              },
            },
            required: ["url"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
      execute: async (params: { url: string }): Promise<URLScanResult> => {
        this.logger.info({ url: params.url }, "Executing urlscan tool");

        return await this.env.URLSCAN_SERVICE.urlScan({
          url: params.url,
          id: this.id,
        });
      },
    },
    submit_report_for_review: {
      definition: {
        type: "function",
        function: {
          name: "submit_report_for_review",
          description: "Submits a report, which concludes the task.",
          parameters: {
            type: "object", // Use lowercase "object" in JSON Schema
            properties: {
              report: {
                type: "string", // Use lowercase "string" in JSON Schema
                description:
                  "The content of the report. This should enough context for readers to stay safe and informed. Try and be succinct.",
              },
              sources: {
                type: "array",
                items: {
                  type: "string",
                  description:
                    "A link from which you sourced content for your report.",
                },
                description:
                  "A list of links from which your report is based. Avoid including the original link sent in for checking as that is obvious.",
              },
              is_controversial: {
                type: "boolean",
                description:
                  "True if the content contains political or religious viewpoints that are grounded in opinions rather than provable facts, and are likely to be divisive or polarizing.",
              },
            },
            required: ["report", "sources", "is_controversial"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
      execute: async (params: {
        report: string;
        sources: string[];
        is_controversial: boolean;
      }): Promise<ReviewResult> => {
        this.logger.info(params, "Executing submit report tool");

        return {
          success: true,
          result: {
            feedback: params.report,
            passedReview: params.is_controversial,
          },
        };
      },
    },
  };

  private async callTool(toolCall: ChatCompletionMessageToolCall) {
    const toolName = toolCall.function.name as keyof typeof this.tools;
    const toolParams = JSON.parse(toolCall.function.arguments);

    this.logger.info(
      {
        toolName,
        toolParams,
        toolCallId: toolCall.id,
      },
      `Calling tool ${toolName}`
    );

    try {
      if (!this.tools[toolName]) {
        this.logger.error(`Tool ${toolName} not found in available tools`);
        return {
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: Tool ${toolName} not found in available tools`,
        };
      }

      const response = await this.tools[toolName].execute(toolParams);

      if (!response.success) {
        return {
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: Tool ${toolName} failed with error ${response.error.message}`,
        };
      } else {
        this.logger.info({ toolName }, "Tool executed successfully");
      }

      const result = response.result;

      // Special handling for screenshot tool
      if (toolName === "get_website_screenshot") {
        const url = toolParams.url || "unknown URL";

        if (!("url" in result)) {
          this.logger.warn({ url }, "Screenshot API failed");
          return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Screenshot API failed for ${url}`,
          };
        }

        this.logger.info({ url }, "Screenshot successfully taken");
        return [
          {
            role: "tool",
            tool_call_id: toolCall.id,
            content:
              "Screenshot successfully taken and will be subsequently appended.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Here is the screenshot for ${url} returned by get_website_screenshot`,
              },
              {
                type: "image_url",
                image_url: {
                  url: result.url,
                },
              },
            ],
          },
        ];
      }

      // Handle other tools

      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      };
    } catch (error) {
      this.logger.error(
        {
          toolName,
          error: error instanceof Error ? error.message : String(error),
        },
        `Error calling tool ${toolName}`
      );

      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: `Function ${toolName} generated an error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async agentLoop() {}

  async check(
    request: AgentRequest,
    provider: "openai" | "vertex-ai" = "openai"
  ) {
    this.client = await createClient(provider, this.env);
    if (request.text) {
      this.text = request.text;
      this.type = "text";
    } else if (request.imageUrl) {
      this.imageUrl = request.imageUrl;
      if (request.caption) {
        this.caption = request.caption;
      }
      this.type = "image";
    }

    // Run the agent loop and return results
    return await this.agentLoop();
  }

  async sayHello(name: string): Promise<string> {
    return `Hello`;
  }
}
