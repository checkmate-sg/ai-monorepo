import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";

const logger = createLogger("upsertBlacklist");

export class UpsertBlacklist extends OpenAPIRoute {
  schema = {
    tags: ["Blacklist"],
    summary: "Update the phone number blacklist",
    description: "Replace the entire phone number blacklist with a new list. This will overwrite any existing blacklist.",
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
              phoneNumbers: z
                .array(z.string())
                .describe("Array of phone numbers to blacklist"),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      "200": {
        description: "Blacklist updated successfully",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              count: z.number().describe("Number of unique phone numbers in the blacklist"),
              version: Str().describe("Version identifier for this blacklist update"),
            }),
          },
        },
      },
      "400": {
        description: "Bad request - invalid input",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              error: Str(),
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
              error: Str(),
            }),
          },
        },
      },
    },
  };

  async handle(c: Context) {
    // Get validated data
    const data = await this.getValidatedData<typeof this.schema>();

    // Retrieve the validated phone numbers
    const { phoneNumbers } = data.body;

    const requestId = c.req.header("x-request-id") || crypto.randomUUID();

    // Log the request
    logger.info(
      { 
        count: phoneNumbers.length, 
        requestId 
      }, 
      "Processing blacklist update request"
    );

    try {
      // Call the blacklist service to update the blacklist
      const result = await c.env.BLACKLIST_SERVICE.updateBlacklist(
        phoneNumbers
      );

      c.header("x-request-id", requestId);

      if (result.success) {
        logger.info(
          { 
            count: result.count, 
            version: result.version,
            requestId 
          }, 
          "Blacklist updated successfully"
        );
        
        return c.json({
          success: true,
          count: result.count,
          version: result.version,
        });
      } else {
        logger.error(
          { error: result.error, requestId },
          "Blacklist update failed"
        );
        
        return c.json(
          {
            success: false,
            error: result.error || "Failed to update blacklist",
          },
          500
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error occurred in upsertBlacklist handler";

      // Include request ID in error logs
      logger.error(
        { error, errorMessage, requestId },
        "Error in upsertBlacklist handler"
      );

      // Return the request ID in the response headers even for errors
      c.header("x-request-id", requestId);

      return c.json(
        {
          success: false,
          error: errorMessage,
        },
        500
      );
    }
  }
}