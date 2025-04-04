import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";
import { EmbedRequest, EmbedResult } from "@workspace/shared-types";
/**
 * Embedder Service Worker
 *
 * This worker provides text embedding functionality that can be accessed
 * via HTTP requests or service bindings from other workers.
 */

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("embedder-service");
  private logContext: Record<string, any> = {};

  async fetch(request: Request): Promise<Response> {
    this.logger.info("Received fetch request");
    // For any other request, return a simple message
    const embedding = await this.generateEmbedding(
      "hello",
      "@cf/baai/bge-small-en-v1.5"
    );

    return new Response(JSON.stringify({ embedding }));
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    if (request.id !== undefined) {
      this.logContext["x-request-id"] = request.id;
    }

    try {
      this.logger.info(
        this.logContext,
        `Generating embedding for text of length ${request.text.length}`
      );

      if (!request.text) {
        this.logContext,
          this.logger.error(this.logContext, "Missing required 'text' field");
        throw new Error("Missing required 'text' field");
      }

      const model = request.model || "@cf/baai/bge-small-en-v1.5";
      this.logger.debug(this.logContext, `Using model: ${model}`);

      const embedding = await this.generateEmbedding(request.text, model);

      return {
        embedding,
        model,
        id: request.id,
        success: true,
      };
    } catch (error) {
      this.logger.error(this.logContext, `Error embedding text: ${error}`);
      return {
        error: {
          message: "Failed to embed text",
          details: error,
        },
        id: request.id,
        success: false,
      };
    }
  }

  private async generateEmbedding(
    text: string,
    model: keyof AiModels = "@cf/baai/bge-small-en-v1.5"
  ): Promise<number[]> {
    try {
      // Call the AI binding to generate embeddings
      this.logger.debug(this.logContext, `Running embedding model ${model}`);
      const response = (await this.env.AI.run(model, {
        text,
      })) as AiTextEmbeddingsOutput;
      this.logger.debug(this.logContext, "Successfully generated embedding");
      return response.data[0];
    } catch (error) {
      this.logger.error(
        this.logContext,
        `Error generating embedding: ${error}`
      );
      throw error;
    }
  }
}
