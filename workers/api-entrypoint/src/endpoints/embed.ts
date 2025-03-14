import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Embedding } from "../types";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { EmbedRequest, EmbedResponse } from "@workspace/shared-types";

const logger = createLogger("embeddingFetch");

export class Embed extends OpenAPIRoute {
  schema = {
    tags: ["Embedding"],
    summary: "Get the embedding of a text",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              text: Str({ description: "Text to embed" }),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      "200": {
        description: "Returns the embedding of the text",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              result: z.object({
                embedding: Embedding,
              }),
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
    console.log(c.env.MY_SECRET_NAME_KEY);

    // Retrieve the validated text
    const { text } = data.body;

    const embedRequest: EmbedRequest = {
      text: text,
      id: c.req.header("x-request-id") || crypto.randomUUID(),
    };
    // Log the request body
    logger.info(data.body, "Processing embedding request");

    try {
      // Call Cloudflare Workers AI to generate embedding
      const response = (await c.env.EMBEDDER_SERVICE.embed(
        embedRequest
      )) as EmbedResponse;

      return {
        success: true,
        result: {
          embedding: response.embedding,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to generate embedding: ${error.message}`,
      };
    }
  }
}
