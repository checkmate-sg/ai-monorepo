import { DurableObject } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";
import { Logger } from "pino";
import type OpenAI from "openai";
import { createClient } from "@workspace/shared-llm-client";
import {
  AgentRequest,
  CommunityNote,
  AgentResponse,
  AgentResult,
} from "@workspace/shared-types";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources";
import { createTools, ToolContext } from "./tools";
import { Langfuse, TextPromptClient, observeOpenAI } from "langfuse";
const logger = createLogger("agent");

interface AgentOutputs {
  report: string;
  sources: string[];
  is_controversial: boolean;
}

export class CheckerAgent extends DurableObject<Env> {
  private logger: Logger;
  private searchesRemaining: number;
  private screenshotsRemaining: number;
  private id: string;
  private totalCost: number;
  private client?: OpenAI;
  private intent?: string;
  private isAccessBlocked?: boolean;
  private isVideo?: boolean;
  private imageUrl?: string;
  private caption?: string;
  private text?: string;
  private totalTime?: number;
  private type?: "text" | "image";
  private langfuse: Langfuse;
  private prompt: TextPromptClient;
  private trace?: ReturnType<Langfuse["trace"]>;
  private span?: ReturnType<Langfuse["span"]>;
  private tools: ReturnType<typeof createTools>;
  private state: DurableObjectState;
  /**
   * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
   * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
   *
   * @param ctx - The interface for interacting with Durable Object state
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   */

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = ctx;
    this.searchesRemaining = 5;
    this.screenshotsRemaining = 5;
    if (ctx.id.name) {
      this.id = ctx.id.name;
    } else {
      this.id = crypto.randomUUID();
      logger.warn({ id: this.id }, "Agent created with random ID");
    }
    this.logger = logger.child({
      id: this.id,
    });
    this.logger.info("Agent created");
    this.totalCost = 0;
    this.totalTime = 0;
    this.langfuse = new Langfuse({
      publicKey: this.env.LANGFUSE_PUBLIC_KEY,
      secretKey: this.env.LANGFUSE_SECRET_KEY,
      baseUrl: this.env.LANGFUSE_HOST,
    });
    this.prompt = null as any; // Temporary initialization
    const toolContext: ToolContext = {
      logger: this.logger,
      id: this.id,
      env: this.env,
      langfuse: this.langfuse,
      getSpan: () => this.span,
      getSearchesRemaining: () => this.searchesRemaining,
      getScreenshotsRemaining: () => this.screenshotsRemaining,
      decrementSearches: () => {
        this.searchesRemaining--;
      },
      decrementScreenshots: () => {
        this.screenshotsRemaining--;
      },
      // Functions to get the current values
      getImageUrl: () => this.imageUrl,
      getCaption: () => this.caption,
      getText: () => this.text,
      getIntent: () => this.intent,
      getType: () => this.type,
    };

    this.tools = createTools(toolContext);

    // Call the async initialization method
    this.initialize();
  }

  private async initialize() {
    try {
      this.prompt = await this.langfuse.getPrompt(
        "agent_system_prompt",
        undefined,
        {
          label: this.env.ENVIRONMENT,
          type: "text",
        }
      );
    } catch (error) {
      this.logger.error(error, "Failed to initialize prompt");
    }
  }

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
        return [
          {
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Error: Tool ${toolName} not found in available tools`,
          },
        ];
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

        if (!("imageUrl" in result)) {
          this.logger.warn({ url }, "Screenshot API failed");
          return [
            {
              role: "tool",
              tool_call_id: toolCall.id,
              content: `Screenshot API failed for ${url}`,
            },
          ];
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
                  url: result.imageUrl,
                },
              },
            ],
          },
        ];
      }

      // Handle other tools

      const returnObject = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      };

      if (toolName === "submit_report_for_review") {
        return [
          {
            ...returnObject,
            completed: true,
            agentOutputs: toolParams,
          },
        ];
      }
      return [returnObject];
    } catch (error) {
      this.logger.error(
        {
          toolName,
          error: error instanceof Error ? error.message : String(error),
        },
        `Error calling tool ${toolName}`
      );

      return [
        {
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Function ${toolName} generated an error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ];
    }
  }

  private async agentLoop(startingContent: any[]) {
    const logger = this.logger.child({
      function: "agentLoop",
    });
    let span: ReturnType<Langfuse["span"]> | undefined;
    try {
      if (!this.client) {
        throw new Error("Client not initialized");
      }
      if (!this.trace) {
        throw new Error("Trace not initialized");
      }
      span = this.trace.span({
        name: "agent-loop",
      });
      this.span = span;

      // Rest of the agent loop implementation
      const observedClient = observeOpenAI(this.client, {
        clientInitParams: {
          publicKey: this.env.LANGFUSE_PUBLIC_KEY,
          secretKey: this.env.LANGFUSE_SECRET_KEY,
          baseUrl: this.env.LANGFUSE_HOST,
        },
        langfusePrompt: this.prompt,
        parent: span,
      });

      let systemPrompt = this.prompt.compile({
        datetime: new Date().toISOString(),
        remaining_searches: this.searchesRemaining.toString(),
        remaining_screenshots: this.screenshotsRemaining.toString(),
      });

      // TODO: Implement the rest of the agent loop
      const messages: ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: startingContent,
        },
      ];

      let completed = false;
      let completion: ChatCompletion;
      let toolCalls: ChatCompletionMessageToolCall[];

      while (!completed && messages.length < 50) {
        systemPrompt = this.prompt.compile({
          datetime: new Date().toISOString(),
          remaining_searches: this.searchesRemaining.toString(),
          remaining_screenshots: this.screenshotsRemaining.toString(),
        });
        messages[0].content = systemPrompt;
        completion = await observedClient.chat.completions.create({
          model: "gpt-4o",
          messages: messages as any[],
          temperature: 0.0,
          seed: 11,
          tools: this.toolDefinitions,
          tool_choice: "required",
        });
        messages.push(completion.choices[0].message);
        if (completion.choices[0].message.tool_calls) {
          toolCalls = completion.choices[0].message.tool_calls;
          const toolCallResults = await Promise.all(
            toolCalls.map((toolCall) => this.callTool(toolCall))
          );
          // Sort and flatten the results before adding to messages
          const sortedResults = this.sortToolCallResults(toolCallResults);
          //check if should end
          for (const result of sortedResults) {
            if (result.completed) {
              const agentOutputs: AgentOutputs = result.agentOutputs;
              const returnObject = {
                ...agentOutputs,
                success: true as const,
              };
              span.end({
                output: returnObject,
                metadata: {
                  success: true,
                },
              });
              return returnObject;
            }
          }
          messages.push(...sortedResults);
        } else {
          messages.push({
            role: "user",
            content: "You should only be using the provided tools / functions",
          });
          logger.warn("No tool calls found in completion");
        }
      }
      throw new Error("Agent loop took too many messages");
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, errorMessage }, "Error in agent loop");
      if (span) {
        span.end({
          output: {
            error: { message: errorMessage },
            success: false,
          },
        });
      }
      return {
        error: { message: errorMessage },
        success: false,
      };
    } finally {
      this.span = undefined;
    }
  }

  async check(request: AgentRequest): Promise<AgentResult> {
    const provider = request.provider || "openai";
    const trace = this.langfuse.trace({
      name: "agent-check",
      input: request,
      id: this.id,
      metadata: {
        provider,
      },
    });
    this.trace = trace;
    try {
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
      const preprocessingResult = await this.tools.preprocess_inputs.execute(
        request
      );

      if (!preprocessingResult.success) {
        throw new Error(
          `Preprocessing failed: ${preprocessingResult.error.message}`
        );
      }

      this.intent = preprocessingResult.result.intent;
      this.isAccessBlocked = preprocessingResult.result.is_access_blocked;
      this.isVideo = preprocessingResult.result.is_video;
      const startingContent = preprocessingResult.result.starting_content;
      // Run the agent loop and return results
      const agentLoopResult = await this.agentLoop(startingContent);
      if (!agentLoopResult.success || "error" in agentLoopResult) {
        throw new Error(`Agent loop failed: ${agentLoopResult.error.message}`);
      }
      const report = agentLoopResult.report;
      const sources = agentLoopResult.sources;
      const isControversial = agentLoopResult.is_controversial;
      const summariseResult = await this.tools.summarise_report.execute({
        report,
      });
      if (!summariseResult.success) {
        throw new Error(
          `Summarise report failed: ${summariseResult.error.message}`
        );
      }
      const summary = summariseResult.result.summary;

      const translateResult = await this.tools.translate_text.execute({
        text: summary,
        language: "cn",
      });
      if (!translateResult.success) {
        throw new Error(
          `Translate text failed: ${translateResult.error.message}`
        );
      }

      const translatedSummary = translateResult.result.translatedText;

      const communityNote: CommunityNote = {
        en: translatedSummary,
        cn: summary,
        links: sources,
      };

      const agentResponse: AgentResponse = {
        success: true,
        report,
        communityNote,
        isControversial,
        isVideo: this.isVideo,
        isAccessBlocked: this.isAccessBlocked,
      };

      trace.update({
        output: agentResponse,
        tags: [this.env.ENVIRONMENT, "agent-generation", "cloudflare-workers"],
      });
      return agentResponse;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, errorMessage }, "Error in agent check");
      const errorReturn = {
        error: { message: errorMessage },
        success: false as const,
      };
      trace.update({
        output: errorReturn,
        tags: [
          this.env.ENVIRONMENT,
          "agent-generation",
          "cloudflare-workers",
          "error",
        ],
      });
      return errorReturn;
    } finally {
      this.state.waitUntil(this.langfuse.flushAsync());
    }
  }

  async sayHello(name: string): Promise<string> {
    return `Hello`;
  }

  async test_search_google() {
    const result = await this.tools.search_google.execute({
      q: "What is the capital of France?",
    });
    return result;
  }

  async test_preprocess_inputs() {
    const result = await this.tools.preprocess_inputs.execute({
      text: "Donald Trump is an idiot",
    });
    return result;
  }

  /**
   * Gets the available tool definitions, removing search and screenshot tools
   * when their respective counters reach zero
   */
  private get toolDefinitions(): ChatCompletionTool[] {
    return Object.entries(this.tools)
      .filter(([name, _]) => {
        // Filter out all the unused tools
        if (
          name === "preprocess_inputs" ||
          name === "extract_image_urls" ||
          name === "summarise_report" ||
          name === "translate_text"
        ) {
          return false;
        }

        // Filter out search tool if no searches remaining
        if (name === "search_google" && this.searchesRemaining <= 0) {
          return false;
        }

        // Filter out screenshot tool if no screenshots remaining
        if (
          name === "get_website_screenshot" &&
          this.screenshotsRemaining <= 0
        ) {
          return false;
        }

        return true;
      })
      .map(([_, tool]) => tool.definition);
  }

  /**
   * Sorts and flattens tool call results to ensure all "tool" role messages
   * appear before any "user" role messages
   */
  private sortToolCallResults(results: any[]): any[] {
    // Flatten nested arrays
    const flattened = results.flat();

    // Separate tool and user messages
    const toolMessages = flattened.filter((msg) => msg.role === "tool");
    const userMessages = flattened.filter((msg) => msg.role === "user");

    // Return with tool messages first, followed by user messages
    return [...toolMessages, ...userMessages];
  }
}
