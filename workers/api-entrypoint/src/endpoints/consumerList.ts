import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import {
  ConsumerCountsSchema,
  SuccessResponseSchema,
  ErrorResponseSchema,
} from "../schemas";

const logger = createLogger("consumerList");

export class ConsumerList extends OpenAPIRoute {
  schema = {
    tags: ["Consumer"],
    summary: "List all registered consumers",
    responses: {
      "200": {
        description: "Returns a list of all consumers",
        content: {
          "application/json": {
            schema: SuccessResponseSchema(z.array(ConsumerCountsSchema)),
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
    const requestId = c.req.header("x-request-id") || crypto.randomUUID();
    logger.info({ requestId }, "Processing list consumers request");

    try {
      // Get all consumers from the registry
      const consumers = await c.env.CONSUMER_KV.list({ prefix: "consumer:" });
      console.log(consumers);
      // Create an array to store consumer details
      const consumerDetails = [];

      // Loop through each consumer and get details from their Durable Object
      for (const key of consumers.keys) {
        const consumerName = key.name.replace("consumer:", "");
        const apiKey = await c.env.CONSUMER_KV.get(key.name);

        if (apiKey) {
          // Get the Durable Object stub
          const id = c.env.CONSUMER.idFromName(apiKey);
          const consumerStub = c.env.CONSUMER.get(id);

          // Get consumer details
          const name = await consumerStub.getName();
          if (!name) {
            logger.warn({ apiKey }, "Consumer name not found");
            continue;
          }
          if (consumerName !== name) {
            logger.warn(
              { apiKey, consumerName, name },
              "Consumer name mismatch"
            );
            continue;
          }
          const counts = await consumerStub.getDetails();

          consumerDetails.push({
            ...counts,
          });
        }
      }

      return {
        success: true,
        result: consumerDetails,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to list consumers");
      return c.json(
        {
          success: false,
          error: `Failed to list consumers: ${error.message}`,
        },
        500
      );
    }
  }
}
