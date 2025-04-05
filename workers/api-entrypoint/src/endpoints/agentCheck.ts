import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { AgentRequest, AgentResult } from "@workspace/shared-types";
import { ErrorResponseSchema, SuccessResponseSchema } from "../schemas";

const logger = createLogger("agentCheck");

// Define the agent check result schema
export const AgentCheckResultSchema = z.object({
  report: Str(),
  communityNote: z.object({
    en: Str(),
    cn: Str(),
    links: z.array(Str()),
  }),
  isControversial: Bool(),
  isVideo: Bool(),
  isAccessBlocked: Bool(),
});

// Define the shared request schema
export const agentRequestSchema = {
  headers: z.object({
    "x-request-id": z
      .string()
      .nullish()
      .describe("Unique request identifier for tracing"),
    "x-api-key": z
      .string({
        required_error: "API key is required for authentication",
      })
      .describe("API key for authentication"),
  }),
  body: {
    content: {
      "application/json": {
        schema: z
          .object({
            // For text-only requests
            text: z.string().optional(),
            // For image requests
            imageUrl: z.string().optional(),
            caption: z.string().optional(),
            // Common properties
            provider: z.enum(["openai", "vertex-ai", "groq"]).optional(),
            findSimilar: z.boolean().optional(),
          })
          .describe(
            "Request body schema. For text, pass 'text' only. For image, pass 'imageUrl' or 'caption'. Leave 'provider' blank for default."
          )
          .refine(
            (data) =>
              (data.text && !data.imageUrl) || (data.imageUrl && !data.text),
            {
              message:
                "Either 'text' OR 'imageUrl' must be provided, but not both",
            }
          ),
        examples: {
          "Text Request Example": {
            value: {
              text: "Hello",
            },
            summary: "Example of a text-only request",
          },
          "Image Request Example": {
            value: {
              imageUrl: "https://example.com/image.jpg",
              caption: "Is this true?",
            },
            summary: "Example of an image request with caption",
          },
        },
      },
    },
    required: true,
  },
};

// Extracted handler logic that can be reused
export async function handleAgentRequest(
  c: Context,
  data: {
    headers?: { "x-request-id"?: string | null };
    body: {
      text?: string;
      imageUrl?: string;
      caption?: string;
      provider?: "openai" | "vertex-ai" | "groq";
      findSimilar?: boolean;
    };
  },
  loggerInstance = logger,
  removeReport = false
): Promise<Response> {
  // Extract request ID from headers
  const requestId = data.headers?.["x-request-id"] || crypto.randomUUID();
  const childLogger = loggerInstance.child({ requestId });
  const { text, imageUrl, caption, provider, findSimilar } = data.body;
  let agentRequest: AgentRequest;
  if (text) {
    agentRequest = {
      text,
      id: requestId, // Use request ID as fallback if id not provided
    };
  } else if (imageUrl) {
    agentRequest = {
      imageUrl,
      caption,
      id: requestId, // Use request ID as fallback if id not provided
    };
    if (caption) {
      agentRequest.caption = caption;
    }
  } else {
    throw new Error("No text or imageUrl provided");
  }
  if (provider) {
    agentRequest.provider = provider;
  }
  const consumerName = c.get("consumerName");
  if (consumerName) {
    agentRequest.consumerName = consumerName;
  }
  if (findSimilar === false) {
    agentRequest.findSimilar = false;
  } else {
    agentRequest.findSimilar = true;
  }

  try {
    // Add request ID to logger context
    childLogger.info("Processing agent check request");

    const agentResult: AgentResult = await c.env.AGENT_SERVICE.check(
      agentRequest
    );
    // Return the request ID in the response headers
    c.header("x-request-id", requestId);

    if (agentResult.success) {
      childLogger.info(agentResult, "Agent check completed, returning results");
      if (removeReport) {
        const { report, ...resultWithoutReport } = agentResult.result;
        return c.json({
          success: true,
          result: resultWithoutReport,
        });
      } else {
        return c.json(agentResult);
      }
    } else {
      // When success is false, we have an ErrorResponse with an error property
      childLogger.error(
        { error: agentResult.error, requestId },
        "Agent check failed"
      );
      throw new Error("An error occurred while running the agent check");
    }
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred in agentCheck handler";

    // Include request ID in error logs
    childLogger.error(
      { error, errorMessage, requestId },
      "Error in agentCheck handler"
    );

    // Return the request ID in the response headers even for errors
    c.header("x-request-id", requestId);

    return c.json(
      {
        success: false,
        error: "Internal server error",
      },
      500
    );
  }
}

export class AgentCheck extends OpenAPIRoute {
  schema = {
    tags: ["Agent"],
    summary: "Get the result of the agent check",
    security: [{ ApiKeyAuth: [] }],
    request: agentRequestSchema,
    responses: {
      "200": {
        description: "Returns the agent check result",
        content: {
          "application/json": {
            schema: SuccessResponseSchema(AgentCheckResultSchema),
          },
        },
      },
      "500": {
        description: "Error response",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  };

  async handle(c: Context): Promise<Response> {
    const data = await this.getValidatedData<typeof this.schema>();
    return handleAgentRequest(c, data, logger);
  }
}
