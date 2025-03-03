import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { AgentRequest } from "@workspace/shared-types";

const logger = createLogger("communityNote");

export class CommunityNote extends OpenAPIRoute {
  schema = {
    tags: ["Agent"],
    summary: "Get only the community note",
    request: {
      headers: z.object({
        "x-request-id": z
          .string()
          .nullish()
          .describe("Unique request identifier for tracing"),
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
              })
              .refine(
                (data) =>
                  (data.text && !data.imageUrl) ||
                  (data.imageUrl && !data.text),
                {
                  message:
                    "Either 'text' OR 'imageUrl' must be provided, but not both",
                }
              ),
          },
        },
        required: true,
      },
    },
    responses: {
      "200": {
        description: "Returns the agent check result",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              communityNote: z.object({
                en: Str(),
                cn: Str(),
                links: z.array(Str()),
              }),
              isControversial: Bool(),
              isVideo: Bool(),
              isAccessBlocked: Bool(),
            }),
          },
        },
      },
      "500": {
        description: "Error response",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              error: z.object({
                message: Str(),
                code: Str().optional(),
                details: z.unknown().optional(),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: Context): Promise<Response> {
    const data = await this.getValidatedData<typeof this.schema>();

    // Extract request ID from headers
    const requestId = data.headers?.["x-request-id"] || crypto.randomUUID();
    const childLogger = logger.child({ requestId });
    const { text, imageUrl, caption, provider } = data.body;
    let agentRequest: AgentRequest;
    if (text) {
      agentRequest = {
        text,
        id: requestId, // Use provided id or request ID as fallback
      };
    } else if (imageUrl) {
      agentRequest = {
        imageUrl,
        caption,
        id: requestId, // Use provided id or request ID as fallback
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

    try {
      // Add request ID to logger context
      childLogger.info("Processing community note request");

      const agentResult = await c.env.CHECKER_AGENT.check(agentRequest);

      // Return the request ID in the response headers
      c.header("x-request-id", requestId);

      //remove report from the result
      const { report, ...rest } = agentResult;

      childLogger.info(
        rest,
        "Community note check completed, returning results"
      );
      return c.json(rest);
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

      return c.json({
        success: false,
        error: {
          message: "Internal server error",
          requestId, // Include the request ID in the error response
        },
      });
    }
  }
}
