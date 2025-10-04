import { Bool, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { CheckUpdate } from "@workspace/shared-types";
import {
  ErrorResponseSchema,
  SuccessResponseSchema,
} from "../schemas";

const logger = createLogger("patchCheck");

// Define the request schema for PATCH /check/:id
export const patchCheckRequestSchema = {
  headers: z.object({
    "x-api-key": z
      .string({
        required_error: "API key is required for authentication",
      })
      .describe("API key for authentication"),
  }),
  params: z.object({
    id: z.string().describe("The ID of the check to update"),
  }),
  body: {
    content: {
      "application/json": {
        schema: z.object({
          isHumanAssessed: z.boolean().describe("Whether the check has been human assessed"),
          crowdsourcedCategory: z.string().nullable().describe("The crowdsourced category"),
          isCommunityNoteDownvoted: z.boolean().nullable().describe("Whether the community note is downvoted"),
        }),
      },
    },
  },
};

// Extracted handler logic that can be reused
export async function handlePatchCheck(
  c: Context,
  data: {
    params: {
      id: string;
    };
    body: {
      isHumanAssessed: boolean;
      crowdsourcedCategory: string | null;
      isCommunityNoteDownvoted: boolean | null;
    };
  },
  loggerInstance = logger
): Promise<Response> {
  const { id } = data.params;
  const childLogger = loggerInstance.child({ id });

  try {
    childLogger.info({ checkId: id, updateData: data.body }, "Patching check");

    // Assemble the CheckUpdate object
    const checkUpdate: CheckUpdate = {
      id,
      ...data.body,
    };

    // Put the update into the queue
    await c.env.POLL_UPDATE_QUEUE.send(checkUpdate);

    childLogger.info({ checkUpdate }, "Check update queued successfully");

    return c.json({
      success: true,
      message: "Check update queued successfully",
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred in patchCheck handler";

    childLogger.error({ error, errorMessage, id }, "Error in patchCheck handler");

    return c.json(
      {
        success: false,
        error: "Internal server error",
      },
      500
    );
  }
}

export class PatchCheck extends OpenAPIRoute {
  schema = {
    tags: ["Agent"],
    summary: "Update a check with human assessment data",
    security: [{ ApiKeyAuth: [] }],
    request: patchCheckRequestSchema,
    responses: {
      "200": {
        description: "Check update queued successfully",
        content: {
          "application/json": {
            schema: SuccessResponseSchema(
              z.object({
                message: z.string(),
              })
            ),
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
    return handlePatchCheck(c, data, logger);
  }
}
