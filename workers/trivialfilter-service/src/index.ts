/**
 * Search Service Worker
 *
 * This worker is responsible for searching the web for information
 * It uses the Serper API to search the web
 *
 * @see https://serper.dev/
 */

import {
  TrivialFilterRequest,
  TrivialFilterResult,
} from "@workspace/shared-types";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";
import { Langfuse, observeOpenAI } from "langfuse";
import { createClient } from "@workspace/shared-llm-client";

const configObject = {
  model: "gpt-4o",
  temperature: 0,
  seed: 11,
  response_format: {
    type: "json_schema" as const,
    json_schema: {
      name: "needs_checking",
      schema: {
        type: "object",
        properties: {
          reasoning: {
            type: "string",
            description:
              "A detailed explanation of why the message does or does not require checking. This field should clearly articulate the decision-making process.",
          },
          needs_checking: {
            type: "boolean",
            description:
              "A flag indicating whether the message contains content that requires checking. Set to true if it needs checking; false otherwise.",
          },
        },
        required: ["reasoning", "needs_checking"],
        additionalProperties: false,
      },
    },
  },
};

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("trivialcheck-service");
  private logContext: Record<string, any> = {};

  async fetch(request: Request): Promise<Response> {
    if (this.env.ENVIRONMENT === "development") {
      this.logger.info("Received fetch request");
      // transform request body to search request
      const body = (await request.json()) as any;
      body.id = request.headers.get("x-request-id");
      const checkRequest = body as TrivialFilterRequest;
      const result = await this.checkNeedsChecking(checkRequest);
      return new Response(JSON.stringify(result), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    } else {
      return new Response("Not implemented", {
        status: 501,
      });
    }
  }

  async checkNeedsChecking(
    request: TrivialFilterRequest
  ): Promise<TrivialFilterResult> {
    this.logContext = {
      request,
    };

    this.logger.info(
      this.logContext,
      "Received needs checking assessment request"
    );

    let langfuse: Langfuse | undefined;

    try {
      const provider = "openai";
      langfuse = new Langfuse({
        publicKey: this.env.LANGFUSE_PUBLIC_KEY,
        secretKey: this.env.LANGFUSE_SECRET_KEY,
        baseUrl: this.env.LANGFUSE_HOST,
      });

      if (!langfuse) {
        this.logger.error(this.logContext, "Langfuse is not configured");
      }

      const trace = langfuse.trace({
        name: "needs-checking",
        input: request,
        id: request.id || crypto.randomUUID(),
        metadata: {
          provider: provider,
        },
      });

      const needsCheckingPrompt = await langfuse.getPrompt(
        "trivial_filter",
        undefined,
        {
          label: this.env.ENVIRONMENT,
          type: "chat",
        }
      );

      // Compile the prompt with the report and formatted sources
      const config = needsCheckingPrompt.config as typeof configObject;
      const messages = needsCheckingPrompt.compile({
        message: request.text,
      });

      const client = await createClient(provider, this.env);

      const observedClient = observeOpenAI(client, {
        clientInitParams: {
          publicKey: this.env.LANGFUSE_PUBLIC_KEY,
          secretKey: this.env.LANGFUSE_SECRET_KEY,
          baseUrl: this.env.LANGFUSE_HOST,
        },
        langfusePrompt: needsCheckingPrompt,
        parent: trace,
      });

      this.logger.info(this.logContext, "Calling LLM api");

      const response = await observedClient.chat.completions.create({
        model: config.model || "gpt-4o",
        temperature: config.temperature || 0,
        seed: config.seed || 11,
        messages: messages as any[],
        response_format: config.response_format,
      });

      const content = response.choices[0].message.content || "{}";
      const result = JSON.parse(content);
      if ("needs_checking" in result) {
        const returnObject = {
          success: true,
          result: {
            needsChecking: result.needs_checking,
          },
          id: request.id,
        };
        trace.update({
          output: returnObject,
          tags: [
            this.env.ENVIRONMENT,
            "single-call",
            "trivial-filter",
            "cloudflare-workers",
          ],
        });
        return returnObject;
      } else {
        throw new Error("No needs_checking in result");
      }
    } catch (error) {
      this.logger.error(
        { ...this.logContext, error },
        "Error processing needs checking request"
      );
      return {
        error: {
          message: `Error in needs checking: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
        id: request.id,
        success: false,
      };
    } finally {
      if (langfuse) {
        this.ctx.waitUntil(langfuse.flushAsync());
      }
    }
  }
}
