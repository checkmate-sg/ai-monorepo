import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import {
  ErrorResponseSchema,
  SuccessResponseSchema,
  ConsumerCountsSchema,
} from "../schemas";

const logger = createLogger("consumerGet");

export class ConsumerGet extends OpenAPIRoute {
  schema = {
    tags: ["Consumer"],
    summary: "Get consumer information by API key",
    security: [{ ApiKeyAuth: [] }],
    responses: {
      "200": {
        description: "Returns consumer information",
        content: {
          "application/json": {
            schema: SuccessResponseSchema(ConsumerCountsSchema),
          },
        },
      },
      "401": {
        description: "Unauthorized - Invalid API key",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
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

  async handle(c: Context<{ Bindings: Env }>) {
    try {
      const apiKey = c.req.header("x-api-key");
      if (!apiKey) {
        return c.json(
          {
            success: false,
            error: "API key is required",
          },
          401
        );
      }

      // Get the Durable Object stub
      const id = c.env.CONSUMER.idFromName(apiKey);
      const stub = c.env.CONSUMER.get(id);

      // Check if the consumer exists
      const initialized = await stub.checkConsumerExists();
      if (!initialized) {
        return c.json(
          {
            success: false,
            error: "Invalid API key",
          },
          401
        );
      }

      // Get consumer name and allowed APIs
      const details = await stub.getDetails();

      return c.json(
        {
          success: true,
          result: {
            ...details,
          },
        },
        200
      );
    } catch (error: any) {
      logger.error(
        { error: error.message },
        "Failed to get consumer information"
      );
      return c.json(
        {
          success: false,
          error: `Failed to get consumer information: ${error.message}`,
        },
        500
      );
    }
  }
}
