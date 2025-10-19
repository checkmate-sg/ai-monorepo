import { createLogger } from "@workspace/shared-utils";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  AgentRequestWithUrls,
  preprocessInputs,
} from "./steps/preprocess-inputs";
import { runAgentLoop } from "./steps/agent-loop";
import { summarizeReport } from "./steps/summarize-report";
import { translateText } from "./steps/translate";
import { AgentRequest, AgentResult } from "@workspace/shared-types";
import { extractUrls } from "./steps/extract-urls";
import { downloadImage } from "./steps/download-image";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseExporter } from "langfuse-vercel";
import { Langfuse } from "langfuse";
import { CheckContext } from "./types";

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("ai-checker-service");
  private context: Record<string, any> = {};

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Test endpoints in development
    if (this.env.ENVIRONMENT === "development") {
      const checkCtx: CheckContext = {
        env: this.env,
        logger: this.logger,
        trace: null as any,
        ctx: this.ctx,
      };

      if (url.pathname === "/test/extract-urls" && request.method === "POST") {
        const body = (await request.json()) as AgentRequest;
        const result = await extractUrls(body, checkCtx);
        return Response.json(result);
      }

      if (url.pathname === "/test/preprocess" && request.method === "POST") {
        const body = (await request.json()) as any;
        const result = await preprocessInputs(body, checkCtx);
        return Response.json(result);
      }

      if (url.pathname === "/test/summarize" && request.method === "POST") {
        const body = (await request.json()) as any;
        const result = await summarizeReport(body, checkCtx);
        return Response.json(result);
      }

      if (url.pathname === "/test/translate" && request.method === "POST") {
        const body = (await request.json()) as any;
        const result = await translateText(body, checkCtx);
        return Response.json(result);
      }

      if (
        url.pathname === "/test/download-image" &&
        request.method === "POST"
      ) {
        const body = (await request.json()) as { imageUrl: string };
        const { downloadImage } = await import("./steps/download-image");
        const result = await downloadImage(body, checkCtx);
        return Response.json(result);
      }

      if (url.pathname === "/test/check" && request.method === "POST") {
        const body = (await request.json()) as AgentRequest;
        // Generate a test ID if not provided
        const testRequest = {
          ...body,
          id: body.id || `test-${Date.now()}`,
        };
        const result = await this.check(testRequest);
        return Response.json(result);
      }

      return new Response("hello");
    } else {
      return new Response("Hello from ai-checker-service");
    }
  }

  async check(request: AgentRequest): Promise<AgentResult> {
    // Initialize Langfuse
    const langfuse = new Langfuse({
      environment: this.env.ENVIRONMENT,
      publicKey: this.env.LANGFUSE_PUBLIC_KEY,
      secretKey: this.env.LANGFUSE_SECRET_KEY,
      baseUrl: this.env.LANGFUSE_HOST,
    });

    const sdk = new NodeSDK({
      traceExporter: new LangfuseExporter({
        publicKey: this.env.LANGFUSE_PUBLIC_KEY,
        secretKey: this.env.LANGFUSE_SECRET_KEY,
        baseUrl: this.env.LANGFUSE_HOST,
      }),
    });
    sdk.start();

    // Create ID if not provided
    if (!request.id) {
      request.id = crypto.randomUUID();
    }

    // Create Langfuse trace
    const trace = langfuse.trace({
      name: "ai-checker-service-check",
      input: request,
      id: request.id,
    });

    // Create logger with request context
    const { imageBase64, ...requestWithoutBase64 } = request as any;
    const logger = this.logger.child({
      request: {
        ...requestWithoutBase64,
        imageBase64: imageBase64
          ? `[base64 ${imageBase64.length} chars]`
          : undefined,
      },
    });
    logger.info("Check request received");

    const id = request.id;
    if (!id) {
      logger.error("Missing request id");
      return {
        success: false,
        error: {
          message: "Missing request id",
        },
      };
    }

    // Create context object
    const checkCtx: CheckContext = {
      env: this.env,
      logger,
      trace,
      ctx: this.ctx,
    };

    try {
      // Step 0: Download image
      if (request.imageUrl) {
        checkCtx.logger.info("Step 0: Downloading image");
        const downloadImageResult = await downloadImage(
          {
            imageUrl: request.imageUrl,
            id,
          },
          checkCtx
        );
        if (downloadImageResult.success) {
          request.imageBase64 = downloadImageResult.result.base64;
        }
      }

      // Step 1: Extract URLs
      checkCtx.logger.info("Step 1: Extracting URLs");
      const extractionResult = await extractUrls(request, checkCtx);
      if (!extractionResult.success) {
        checkCtx.logger.error("Failed to extract URLs");
      }

      // Step 2: Preprocess inputs
      checkCtx.logger.info("Step 2: Preprocessing inputs");
      const preprocessingRequest = {
        ...request,
        extractedUrls: extractionResult.urls,
      };
      const preprocessingResponse = await preprocessInputs(
        preprocessingRequest,
        checkCtx
      );
      if (!preprocessingResponse.success) {
        this.logger.error("Failed to preprocess inputs");
      }
      this.logger.info({ preprocessingResponse }, "Preprocessing response");
      if (!("result" in preprocessingResponse)) {
        this.logger.error("No preprocessing result");
        return {
          success: false,
          error: {
            message: "No preprocessing result",
          },
        };
      }
      const preprocessingResult = preprocessingResponse.result;

      this.logger.info({ preprocessingResult }, "Preprocessing result");

      // Step 3: Agent loop
      this.logger.info("Step 3: Running agent loop");
      const agentLoopResult = await runAgentLoop(
        {
          startingMessages: preprocessingResult.startingContent,
          intent: preprocessingResult.intent,
        },
        checkCtx
      );

      this.logger.info({ agentLoopResult }, "Agent loop result");

      // Step 4: Summarize report
      this.logger.info("Step 4: Summarizing report");
      const summary = await summarizeReport(
        {
          startingMessages: preprocessingResult.startingContent,
          intent: preprocessingResult.intent,
          report: agentLoopResult.report,
        },
        checkCtx
      );

      this.logger.info({ summary }, "Summary");

      // Step 5: Translate summary into all languages
      this.logger.info("Step 5: Translating summary");
      const [
        translationChinese,
        translationMalay,
        translationIndonesian,
        translationTamil,
      ] = await Promise.all([
        translateText({ text: summary, targetLanguage: "Chinese" }, checkCtx),
        translateText(
          { text: summary, targetLanguage: "Bahasa Melayu" },
          checkCtx
        ),
        translateText(
          { text: summary, targetLanguage: "Bahasa Indonesia" },
          checkCtx
        ),
        translateText({ text: summary, targetLanguage: "Tamil" }, checkCtx),
      ]);

      return {
        success: true,
        id,
        result: {
          report: {
            en: agentLoopResult.report,
            cn: translationChinese,
            links: agentLoopResult.sources,
            timestamp: new Date(),
          },
          generationStatus: "pending",
          communityNote: {
            en: summary,
            cn: translationChinese,
            ms: translationMalay,
            id: translationIndonesian,
            ta: translationTamil,
            links: agentLoopResult.sources,
            timestamp: new Date(),
          },
          humanNote: null,
          isControversial: agentLoopResult.isControversial,
          text: "text" in request ? request.text ?? null : null,
          imageUrl: "imageUrl" in request ? request.imageUrl ?? null : null,
          caption: "imageUrl" in request ? request.caption ?? null : null,
          isVideo: preprocessingResult.isVideo,
          isAccessBlocked: preprocessingResult.isAccessBlocked,
          title: preprocessingResult.title,
          slug: null,
          timestamp: new Date(),
          isHumanAssessed: false,
          isVoteTriggered: false,
          crowdsourcedCategory: null,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error occurred in ai-checker-service worker";
      this.logger.error(errorMessage);
      return {
        success: false,
        error: {
          message: errorMessage,
        },
      };
    } finally {
      await langfuse.flushAsync();
      await sdk.shutdown();
    }
  }
}
