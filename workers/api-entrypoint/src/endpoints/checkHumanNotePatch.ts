import { Bool, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { CheckUpdate } from "@workspace/shared-types";
import { ErrorResponseSchema, SuccessResponseSchema } from "../schemas";

const logger = createLogger("patchCheckHumanNote");

// Define the request schema for PATCH /check/:id
export const patchCheckHumanNoteRequestSchema = {
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
          en: z.string().nullable().describe("The human note in English"),
          cn: z.string().nullable().describe("The human note in Chinese"),
          links: z
            .array(z.string())
            .nullable()
            .describe("The links to the human note"),
          updatedBy: z.string().describe("The user who updated the human note"),
        }),
      },
    },
  },
};

// Extracted handler logic that can be reused
export async function handlePatchCheckHumanNote(
  c: Context,
  data: {
    params: {
      id: string;
    };
    body: {
      en: string | null;
      cn: string | null;
      links: string[] | null;
      updatedBy: string;
    };
  },
  loggerInstance = logger
): Promise<Response> {
  const { id } = data.params;
  const childLogger = loggerInstance.child({ id });

  try {
    childLogger.info(
      { checkId: id, humanNote: data.body },
      "Patching check human note"
    );

    // Call the agent service to update the human response
    const result = await c.env.CHECKS_SERVICE.updateHumanResponse(
      id,
      data.body
    );

    if (!result.success) {
      childLogger.error({ result }, "Failed to update human note");
      return c.json(
        {
          success: false,
          error:
            "error" in result
              ? result.error.message
              : "Failed to update human note",
        },
        500
      );
    }

    childLogger.info({ checkId: id }, "Human note updated successfully");

    return c.json({
      success: true,
      message: "Human note updated successfully",
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred in patchCheckHumanNote handler";

    childLogger.error(
      { error, errorMessage, id },
      "Error in patchCheckHumanNote handler"
    );

    return c.json(
      {
        success: false,
        error: "Internal server error",
      },
      500
    );
  }
}

export class PatchCheckHumanNote extends OpenAPIRoute {
  schema = {
    tags: ["Agent"],
    summary: "Update a check with human note",
    security: [{ ApiKeyAuth: [] }],
    request: patchCheckHumanNoteRequestSchema,
    responses: {
      "200": {
        description: "Human note updated successfully",
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
    return handlePatchCheckHumanNote(c, data, logger);
  }
}
