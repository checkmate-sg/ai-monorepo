import { createLogger } from "@workspace/shared-utils";
import {
  AgentRequest,
  AgentResult,
  CommunityNote,
} from "@workspace/shared-types";
import { WorkerEntrypoint } from "cloudflare:workers";
export { CheckerAgent } from "./agent";
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
    let id: DurableObjectId = this.env.CHECKER_AGENT.idFromName(
      crypto.randomUUID()
    );

    // This stub creates a communication channel with the Durable Object instance
    // The Durable Object constructor will be invoked upon the first call for a given id
    let stub = this.env.CHECKER_AGENT.get(id);

    // We call the `sayHello()` RPC method on the stub to invoke the method on the remote
    // Durable Object instance
    let result = await stub.check({
      id: "123",
      text: "Donald Trump is the president of the United States",
    });

    return new Response(JSON.stringify(result));
  }

  async check(request: AgentRequest): Promise<AgentResult> {
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
    let objectId = this.env.CHECKER_AGENT.idFromName(id);
    let stub = this.env.CHECKER_AGENT.get(objectId);
    return {
      report: "This is a test report",
      success: true,
      id: request.id,
      communityNote: {
        en: "This is a test community note",
        cn: "这是测试社区注释",
        links: ["https://example.com"],
      },
      isControversial: false,
      isVideo: false,
      isAccessBlocked: false,
    };
  }
}
