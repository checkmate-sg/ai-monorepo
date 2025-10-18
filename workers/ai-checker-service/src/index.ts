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

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("ai-checker-service");
  private context: Record<string, any> = {};

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Test endpoints in development
    if (this.env.ENVIRONMENT === "development") {
      if (url.pathname === "/test/extract-urls" && request.method === "POST") {
        const body = (await request.json()) as AgentRequest;
        const result = await extractUrls(body, this.env, this.logger);
        return Response.json(result);
      }

      if (url.pathname === "/test/preprocess" && request.method === "POST") {
        const body = (await request.json()) as any;
        const result = await preprocessInputs(body, this.env, this.logger);
        return Response.json(result);
      }

      if (url.pathname === "/test/summarize" && request.method === "POST") {
        const body = (await request.json()) as any;
        const result = await summarizeReport(body, this.env, this.logger);
        return Response.json(result);
      }

      if (url.pathname === "/test/translate" && request.method === "POST") {
        const body = (await request.json()) as any;
        const result = await translateText(body, this.env, this.logger);
        return Response.json(result);
      }

      if (
        url.pathname === "/test/download-image" &&
        request.method === "POST"
      ) {
        const body = (await request.json()) as { imageUrl: string };
        const { downloadImage } = await import("./steps/download-image");
        const result = await downloadImage(body, this.env, this.logger);
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
    // Log request without base64 to avoid cluttering logs
    const { imageBase64, ...requestWithoutBase64 } = request as any;
    this.logger = this.logger.child({
      request: {
        ...requestWithoutBase64,
        imageBase64: imageBase64
          ? `[base64 ${imageBase64.length} chars]`
          : undefined,
      },
    });
    this.logger.info("Check request received");

    const id = request.id;
    if (!id) {
      this.logger.error("Missing request id");
      return {
        success: false,
        error: {
          message: "Missing request id",
        },
      };
    }

    try {
      // Step 0: Download image

      if (request.imageUrl) {
        this.logger.info("Step 0: Downloading image");
        const downloadImageResult = await downloadImage(
          {
            imageUrl: request.imageUrl,
            id,
          },
          this.env,
          this.logger
        );
        if (downloadImageResult.success) {
          request.imageBase64 = downloadImageResult.result.base64;
        }
      }
      // Step 1: Extract URLs
      this.logger.info("Step 1: Extracting URLs");
      const extractionResult = await extractUrls(
        request,
        this.env,
        this.logger
      );
      if (!extractionResult.success) {
        this.logger.error("Failed to extract URLs");
      }
      // Step 2: Preprocess inputs
      this.logger.info("Step 2: Preprocessing inputs");
      const preprocessingRequest = {
        ...request,
        extractedUrls: extractionResult.urls,
      };
      const preprocessingResponse = await preprocessInputs(
        preprocessingRequest,
        this.env,
        this.logger
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

      // Step 4: Summarize report
      this.logger.info("Step 4: Summarizing report");
      // const summary = await summarizeReport({
      //   report: agentResult.report,
      // });

      // Step 4: Translate summary
      this.logger.info("Step 5: Translating summary");
      // const translation = await translateText({
      //   text: summary,
      //   targetLanguage: request.languageHint || "Chinese",
      // });

      return {
        success: true,
        id,
        result: {
          report: {
            en: "",
            cn: "",
            links: [],
            timestamp: new Date(),
          },
          generationStatus: "pending",
          communityNote: {
            en: "",
            cn: "",
            links: [],
            timestamp: new Date(),
          },
          humanNote: null,
          isControversial: false,
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
    }
  }
}
