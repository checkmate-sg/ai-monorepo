import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { Consumer } from "../durable-objects/consumer";
import { ErrorResponseSchema, SuccessResponseSchema } from "../schemas";

const logger = createLogger("consumerPost");

export class ConsumerPost extends OpenAPIRoute {
  schema = {
    tags: ["Consumer"],
    summary: "Create a new consumer with API key",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: Str({ description: "Consumer name" }),
              allowedAPIs: z.array(Str({ description: "Allowed APIs" })),
              millisecondsPerRequest: z
                .number({ description: "Milliseconds per request" })
                .optional(),
              capacity: z.number({ description: "Capacity" }).optional(),
              millisecondsForUpdates: z
                .number({ description: "Milliseconds for updates" })
                .optional(),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      "200": {
        description: "Returns the created consumer with API key",
        content: {
          "application/json": {
            schema: SuccessResponseSchema(
              z.object({
                name: Str(),
                apiKey: Str(),
              })
            ),
          },
        },
      },
      "400": {
        description: "Consumer already exists",
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
    // Get validated data
    const data = await this.getValidatedData<typeof this.schema>();

    // Retrieve the validated consumer name and description
    const {
      name,
      allowedAPIs,
      millisecondsPerRequest,
      capacity,
      millisecondsForUpdates,
    } = data.body;
    const requestId = c.req.header("x-request-id") || crypto.randomUUID();

    logger.info({ name, requestId }, "Processing consumer creation request");

    try {
      // 1. Check if consumer already exists
      const consumerExists = await c.env.CONSUMER_KV.get(`consumer:${name}`);

      if (consumerExists) {
        return c.json(
          {
            success: false,
            error: `Consumer with name '${name}' already exists`,
          },
          400
        );
      }

      // 2. Generate API key
      const apiKey = Consumer.generateAPIKey();

      // 3. Create Durable Object from the API key
      const id = c.env.CONSUMER.idFromName(apiKey);

      const stub = c.env.CONSUMER.get(id);

      // 4. Call the createConsumer method of the DO
      const result = await stub.createConsumer({
        name,
        allowedAPIs,
        apiKey,
        millisecondsPerRequest,
        capacity,
        millisecondsForUpdates,
      });

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
            name,
            apiKey,
          },
        },
        200
      );
    } catch (error: any) {
      logger.error({ error: error.message, name }, "Failed to create consumer");
      return c.json(
        {
          success: false,
          error: `Failed to create consumer: ${error.message}`,
        },
        500
      );
    }
  }
}
