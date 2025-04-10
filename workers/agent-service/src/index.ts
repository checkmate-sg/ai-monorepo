import { createLogger } from "@workspace/shared-utils";
import { AgentRequest, AgentResult, Submission } from "@workspace/shared-types";
import { WorkerEntrypoint } from "cloudflare:workers";
export { CheckerAgent } from "./agent";
import { searchInternal } from "./tools/search-internal";
/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("agent-service");
  private logContext: Record<string, any> = {};

  /**
   * This is the standard fetch handler for a Cloudflare Worker
   *
   * @param request - The request submitted to the Worker from the client
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   * @param ctx - The execution context of the Worker
   * @returns The response to be sent back to the client
   */
  async fetch(request: Request): Promise<Response> {
    // We will create a `DurableObjectId` using the pathname from the Worker request
    // This id refers to a unique instance of our 'MyDurableObject' class above
    if (this.env.ENVIRONMENT === "development") {
      let id: DurableObjectId = this.env.CHECKER_AGENT.idFromName(
        crypto.randomUUID()
      );

      // This stub creates a communication channel with the Durable Object instance
      // The Durable Object constructor will be invoked upon the first call for a given id
      let stub = this.env.CHECKER_AGENT.get(id);

      // We call the `sayHello()` RPC method on the stub to invoke the method on the remote
      // Durable Object instance
      let result = await stub.check(
        {
          id: "123",
          imageUrl:
            "https://storage.googleapis.com/checkmate-screenshots-uat/edb4972344acf6e7da688425e4490ab9.png",
          caption: "Is this true?",
        },
        "123"
      );

      return new Response(JSON.stringify(result));
    } else {
      return new Response("Hello from agent-service");
    }
  }

  async check(request: AgentRequest): Promise<AgentResult> {
    // Initialize the repository if needed

    let submissionId: string | null = null;
    let checkId: string | null = null;

    try {
      const submission: Omit<Submission, "_id"> = {
        requestId: request.id ?? null,
        timestamp: new Date(),
        sourceType:
          request.consumerName === "checkmate-whatsapp" ? "internal" : "api",
        consumerName: request.consumerName ?? "unknown",
        type: request.imageUrl ? "image" : "text",
        text: request.text ?? null,
        imageUrl: request.imageUrl ?? null,
        caption: request.caption ?? null,
        checkId: null,
        checkStatus: "pending",
      };
      //find matching check
      if (request.findSimilar) {
        const text = submission.text || submission.caption || "";
        if (text) {
          const searchResult = await searchInternal(text, this.env);

          if (
            searchResult.success &&
            searchResult.result?.isMatch &&
            searchResult.result.id
          ) {
            checkId = searchResult.result.id;
            //TODO: get the check from the database and return the necessary data
          }
        }
      }

      submission.checkId = checkId;

      const result = await this.env.DATABASE_SERVICE.insertSubmission(
        submission
      );
      if (result.success && result.id) {
        submissionId = result.id;
        checkId = result.checkId;
      } else {
        throw new Error("Failed to insert submission");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error(this.logContext, errorMessage);
      throw error;
    }

    this.logContext = {
      request,
    };
    this.logger.info(this.logContext, "Agent checking commenced");
    const id = request.id;
    if (!id) {
      this.logger.error(this.logContext, "Missing request id");
      return {
        success: false,
        error: {
          message: "Missing request id",
        },
      };
    }
    // Create a DurableObjectId from the string id
    if (!checkId) {
      this.logger.error(this.logContext, "Missing check id");
      throw new Error("Missing check id");
    }
    try {
      let objectId = this.env.CHECKER_AGENT.idFromName(checkId);
      let stub = this.env.CHECKER_AGENT.get(objectId);
      const result = await stub.check(request, checkId);
      this.ctx.waitUntil(
        this.env.DATABASE_SERVICE.updateSubmission(submissionId, {
          checkStatus: "completed",
        }).catch((error) => {
          this.logger.error(this.logContext, "Failed to update submission");
          throw error;
        })
      );
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error occurred in agent-service worker";
      this.logger.error(this.logContext, errorMessage);
      this.ctx.waitUntil(
        this.env.DATABASE_SERVICE.updateSubmission(submissionId, {
          checkStatus: "error",
        }).catch((error) => {
          this.logger.error(this.logContext, "Failed to update submission");
          throw error;
        })
      );
      return {
        success: false,
        error: {
          message: errorMessage,
        },
      };
    }
  }
}
