import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { ErrorResponseSchema, SuccessResponseSchema } from "../schemas";

export class HealthCheck extends OpenAPIRoute {
  schema = {
    tags: ["System"],
    summary: "Health check endpoint",
    responses: {
      "200": {
        description: "System is healthy",
        content: {
          "application/json": {
            schema: SuccessResponseSchema(
              z.object({
                status: z.string({ description: "Health status" }),
                timestamp: z.number({ description: "Current timestamp" }),
              })
            ),
          },
        },
      },
      "500": {
        description: "System is unhealthy",
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
      // Perform any health checks here
      // For example, check if KV and Durable Objects are accessible

      return c.json(
        {
          success: true,
          result: {
            status: "healthy",
            timestamp: Date.now(),
          },
        },
        200
      );
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: `System is unhealthy: ${error.message}`,
        },
        500
      );
    }
  }
}
