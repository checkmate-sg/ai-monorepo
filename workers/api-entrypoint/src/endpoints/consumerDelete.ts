import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { ErrorResponseSchema, SuccessResponseSchema } from "../schemas";

const logger = createLogger("consumerDelete");

export class ConsumerDelete extends OpenAPIRoute {
  schema = {
    tags: ["Consumer"],
    summary: "Delete consumer by API key or name",
    security: [{ ApiKeyAuth: [] }],
    parameters: [
      {
        name: "consumerName",
        in: "path",
        description: "Consumer name to delete",
        required: false,
        schema: {
          type: "string",
        },
      } as const,
    ],
    responses: {
      "200": {
        description: "Consumer successfully deleted",
        content: {
          "application/json": {
            schema: SuccessResponseSchema(z.object({})),
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
      "404": {
        description: "Consumer not found",
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
      const consumerName = c.req.param("consumerName");

      // Case 1: Neither API key nor name provided
      if (!apiKey && !consumerName) {
        return c.json(
          {
            success: false,
            error: "Either API key or consumer name is required",
          },
          400
        );
      }

      // Case 2: Both API key and name provided
      if (apiKey && consumerName) {
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

        // Get consumer details to verify name matches
        const name = await stub.getName();
        if (name !== consumerName) {
          return c.json(
            {
              success: false,
              error: "API key does not match the provided consumer name",
            },
            401
          );
        }

        // Delete from Durable Object
        await stub.deleteConsumer();

        // Delete from KV
        await c.env.CONSUMER_KV.delete(`consumer:${consumerName}`);

        return c.json(
          {
            success: true,
            result: {
              message: `Consumer ${consumerName} successfully deleted`,
            },
          },
          200
        );
      }

      // Case 3: Only API key provided
      if (apiKey && !consumerName) {
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

        // Get consumer details to get the name
        const details = await stub.getDetails();
        const name = details.name;

        // Delete from Durable Object
        await stub.deleteConsumer();

        // Delete from KV
        await c.env.CONSUMER_KV.delete(`consumer:${name}`);

        return c.json(
          {
            success: true,
            result: {
              message: `Consumer ${name} successfully deleted`,
            },
          },
          200
        );
      }

      // Case 4: Only name provided
      if (!apiKey && consumerName) {
        // Get API key from KV
        const consumerKey = await c.env.CONSUMER_KV.get(
          `consumer:${consumerName}`
        );

        if (!consumerKey) {
          return c.json(
            {
              success: false,
              error: `Consumer with name ${consumerName} not found`,
            },
            404
          );
        }

        // Get the Durable Object stub
        const id = c.env.CONSUMER.idFromName(consumerKey);
        const stub = c.env.CONSUMER.get(id);

        // Delete from Durable Object
        await stub.deleteConsumer();

        // Delete from KV
        await c.env.CONSUMER_KV.delete(`consumer:${consumerName}`);

        return c.json(
          {
            success: true,
            result: {
              message: `Consumer ${consumerName} successfully deleted`,
            },
          },
          200
        );
      }
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to delete consumer");
      return c.json(
        {
          success: false,
          error: `Failed to delete consumer: ${error.message}`,
        },
        500
      );
    }
  }
}
