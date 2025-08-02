import { Bool, DateTime, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { AgentResult } from "@workspace/shared-types";
import {
  ErrorResponseSchema,
  SuccessResponseSchema,
  CheckResultSchema,
} from "../schemas";

const logger = createLogger("getCheck");

// Define the shared request schema
export const getCheckRequestSchema = {
  headers: z.object({
    "x-api-key": z
      .string({
        required_error: "API key is required for authentication",
      })
      .describe("API key for authentication"),
  }),
  params: z.object({
    id: z.string().describe("The ID of the check to get"),
  }),
};

// Extracted handler logic that can be reused
export async function handleGetCheck(
  c: Context,
  data: {
    params: {
      id: string;
    };
  },
  loggerInstance = logger,
  removeReport = false
): Promise<Response> {
  // Extract request ID from headers
  const { id } = data.params;
  const childLogger = loggerInstance.child({ id });

  try {
    // Add request ID to logger context
    childLogger.info({ checkId: id }, "Getting check by ID");

    const agentResult: AgentResult = await c.env.AGENT_SERVICE.getCheck(id);
    // Return the request ID in the response headers
    if (agentResult.success) {
      childLogger.info(agentResult, "Agent check retrieved successfully");
      return c.json(agentResult);
    } else {
      // When success is false, we have an ErrorResponse with an error property
      childLogger.error(
        { error: agentResult.error, id },
        "Failed to get check"
      );
      throw new Error(agentResult.error?.message || "Failed to get check");
    }
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred in getCheck handler";

    // Include request ID in error logs
    childLogger.error({ error, errorMessage, id }, "Error in getCheck handler");

    return c.json(
      {
        success: false,
        error: "Internal server error",
      },
      500
    );
  }
}

export class GetCheck extends OpenAPIRoute {
  schema = {
    tags: ["Agent"],
    summary: "Get the result of the requested check",
    security: [{ ApiKeyAuth: [] }],
    request: getCheckRequestSchema,
    responses: {
      "200": {
        description: "Returns the agent check result",
        content: {
          "application/json": {
            schema: SuccessResponseSchema(CheckResultSchema),
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
    return handleGetCheck(c, data, logger);
  }
}
