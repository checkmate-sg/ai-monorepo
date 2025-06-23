import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { ErrorResponseSchema, SuccessResponseSchema } from "../schemas";

const logger = createLogger("consumerUpdateAPIs");

export class ConsumerUpdateAPIs extends OpenAPIRoute {
  schema = {
    tags: ["Consumer"],
    summary: "Update allowed APIs for consumer by API key or name",
    parameters: [
      {
        name: "consumerName",
        in: "path",
        description: "Consumer name to update",
        required: false,
        schema: {
          type: "string",
        },
      } as const,
    ],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              allowedAPIs: z.array(Str({ description: "Allowed APIs" })),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      "200": {
        description: "Successfully updated allowed APIs",
        content: {
          "application/json": {
            schema: SuccessResponseSchema(
              z.object({
                message: Str(),
              })
            ),
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
      // Get validated data
      const data = await this.getValidatedData<typeof this.schema>();
      const { allowedAPIs } = data.body;
      
      const apiKey = c.req.header("x-api-key");
      const consumerName = c.req.param("consumerName");
      const requestId = c.req.header("x-request-id") || crypto.randomUUID();

      logger.info({ consumerName, hasApiKey: !!apiKey, requestId }, "Processing consumer API update request");

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

        // Update allowed APIs
        const result = await stub.updateAllowedAPIs(allowedAPIs);

        if (!result.success) {
          return c.json(
            {
              success: false,
              error: result.error?.message || "An unknown error occurred",
            },
            500
          );
        }

        return c.json(
          {
            success: true,
            result: {
              message: `Successfully updated allowed APIs for consumer '${consumerName}'`,
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

        // Update allowed APIs
        const result = await stub.updateAllowedAPIs(allowedAPIs);

        if (!result.success) {
          return c.json(
            {
              success: false,
              error: result.error?.message || "An unknown error occurred",
            },
            500
          );
        }

        return c.json(
          {
            success: true,
            result: {
              message: `Successfully updated allowed APIs for consumer '${name}'`,
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
              error: `Consumer with name '${consumerName}' not found`,
            },
            404
          );
        }

        // Get the Durable Object stub
        const id = c.env.CONSUMER.idFromName(consumerKey);
        const stub = c.env.CONSUMER.get(id);

        // Update allowed APIs
        const result = await stub.updateAllowedAPIs(allowedAPIs);

        if (!result.success) {
          return c.json(
            {
              success: false,
              error: result.error?.message || "An unknown error occurred",
            },
            500
          );
        }

        return c.json(
          {
            success: true,
            result: {
              message: `Successfully updated allowed APIs for consumer '${consumerName}'`,
            },
          },
          200
        );
      }
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to update consumer APIs");
      return c.json(
        {
          success: false,
          error: `Failed to update consumer APIs: ${error.message}`,
        },
        500
      );
    }
  }
}