import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { TrivialFilterRequest } from "@workspace/shared-types";

const logger = createLogger("trivialFilter");

export class TrivialFilter extends OpenAPIRoute {
  schema = {
    tags: ["Embedding"],
    summary: "Get the embedding of a text",
    security: [{ ApiKeyAuth: [] }],
    request: {
      headers: z.object({
        "x-api-key": z
          .string({
            required_error: "API key is required for authentication",
          })
          .describe("API key for authentication"),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              text: Str({ description: "Text to check" }),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      "200": {
        description: "Returns the embedding of the text",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              result: z.object({
                needsChecking: z.boolean(),
              }),
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

  async handle(c: Context) {
    // Get validated data
    const data = await this.getValidatedData<typeof this.schema>();

    // Retrieve the validated text
    const { text } = data.body;

    const requestId = c.req.header("x-request-id") || crypto.randomUUID();

    const trivalFilterRequest: TrivialFilterRequest = {
      text: text,
      id: requestId,
    };
    // Log the request body
    logger.info(data.body, "Processing trivial filter request");

    try {
      // Call Cloudflare Workers AI to generate embedding
      const result = await c.env.TRIVIAL_FILTER_SERVICE.checkNeedsChecking(
        trivalFilterRequest
      );

      c.header("x-request-id", requestId);
      logger.info(result, "Trivial filter completed, returning results");
      if (result.success) {
        return c.json(result);
      } else {
        logger.error(
          { error: result.error, requestId },
          "Trivial filter failed"
        );
        throw new Error("An error occurred while running the trivial filter");
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error occurred in agentCheck handler";

      // Include request ID in error logs
      logger.error(
        { error, errorMessage, requestId },
        "Error in agentCheck handler"
      );

      // Return the request ID in the response headers even for errors
      c.header("x-request-id", requestId);

      return c.json(
        {
          success: false,
          error: {
            message: "Internal server error",
            requestId, // Optionally include the request ID in the error response
          },
        },
        500
      );
    }
  }
}
