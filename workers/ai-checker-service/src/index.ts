import { createLogger, getSlugFromTitle } from "@workspace/shared-utils";
import { WorkerEntrypoint } from "cloudflare:workers";
import { truncateBase64 } from "./utils/truncate-base64";
import {
  AgentRequestWithUrls,
  preprocessInputs,
} from "./steps/preprocess-inputs";
import { runAgentLoop } from "./steps/agent-loop";
import { summarizeReport } from "./steps/summarize-report";
import { translateText } from "./steps/translate";
import {
  AgentRequest,
  AgentResponse,
  AgentResult,
  CommunityNote,
  ErrorType,
  Report,
  Submission,
} from "@workspace/shared-types";
import { extractUrls } from "./steps/extract-urls";
import { downloadImage } from "./steps/download-image";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseExporter } from "langfuse-vercel";
import { Langfuse } from "langfuse";
import { CheckContext } from "./types";
import { findSimilar } from "./steps/find-similar";
import { getCheck } from "./lib/get-check";
import { createCheck } from "./lib/create-check";
import { sendCommunityNoteNotification } from "./lib/send-community-note-notification";
import { updateCheck } from "./lib/update-check";
import { triggerVoting } from "./lib/trigger-voting";
import { id } from "zod/v4/locales";

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
    let submissionId: string | null = null;
    let checkId: string | null = null;
    let notificationId: number | null = null;
    let communityNoteNotificationId: number | null = null;
    let communityNote: CommunityNote | null = null;
    let longformReport: Report | null = null;
    let isControversial = false;
    let generationStatus: string = "pending";
    let isAccessBlocked = false;
    let isVideo = false;
    let title: string | null = null;
    let slug: string | null = null;

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
    // Create context object
    const checkCtx: CheckContext = {
      env: this.env,
      logger,
      trace: null as any,
      ctx: this.ctx,
    };

    // Check for similar submissions
    try {
      if (request.findSimilar) {
        const findSimilarResult = await findSimilar(request, checkCtx);
        if (findSimilarResult.success) {
          if (
            findSimilarResult.result?.isMatch &&
            findSimilarResult.result.id
          ) {
            checkId = findSimilarResult.result.id;
            const check = await getCheck(checkId, checkCtx);
            if (check.success) {
              submission.checkId = checkId;
              submission.checkStatus = check.result.generationStatus as
                | "pending"
                | "completed"
                | "error";

              const insertResult =
                await this.env.DATABASE_SERVICE.insertSubmission(submission);

              if (!insertResult.success) {
                throw new Error("Failed to insert submission");
              }

              logger.info(
                {
                  checkId,
                  submissionId: insertResult.id,
                  similarityScore: findSimilarResult.result.similarityScore,
                },
                "Found similar submission, returning existing check result"
              );

              return check;
            } else {
              logger.error(
                { error: check.error },
                "Failed to get check from similar submission"
              );
            }
          }
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error occurred in ai-checker-service worker";
      logger.error(
        { error, errorMessage },
        "Error checking for similar submissions, proceeding with new check"
      );
    }

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

    try {
      const result = await this.env.DATABASE_SERVICE.insertSubmission(
        submission
      );
      if (result.success && result.id) {
        submissionId = result.id;
        checkId = result.checkId;
      } else {
        throw new Error("Failed to insert submission");
      }
      logger.info(
        { submissionId, checkId },
        "Submission inserted, proceeding with check"
      );

      if (!checkId) {
        throw new Error("Missing check id");
      }

      //create check
      const timestamp = new Date();
      const createCheckResult = await createCheck(
        request,
        checkCtx,
        checkId,
        timestamp
      );
      if (!createCheckResult.success) {
        throw new Error("Failed to create check");
      }

      notificationId = createCheckResult.result.notificationId;

      // Create Langfuse trace
      const trace = langfuse.trace({
        name: "ai-checker-service-check",
        input: request,
        id: checkId,
      });

      checkCtx.trace = trace;

      // Step 0: Download image
      if (request.imageUrl) {
        checkCtx.logger.info("Step 0: Downloading image");
        const downloadImageResult = await downloadImage(
          {
            imageUrl: request.imageUrl,
            id: checkId,
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
        logger.error("Failed to preprocess inputs");
      }
      logger.info(
        truncateBase64({ preprocessingResponse }),
        "Preprocessing response"
      );
      if (!("result" in preprocessingResponse)) {
        logger.error("No preprocessing result");
        return {
          success: false,
          error: {
            message: "No preprocessing result",
          },
        };
      }
      const preprocessingResult = preprocessingResponse.result;

      const intent = preprocessingResult.intent;
      const startingContent = preprocessingResult.startingContent;
      isAccessBlocked = preprocessingResult.isAccessBlocked;
      isVideo = preprocessingResult.isVideo;
      title = preprocessingResult.title;
      slug = title ? getSlugFromTitle(title, checkId) : null;

      this.logger.info(
        truncateBase64({ preprocessingResult }),
        "Preprocessing result"
      );

      // Update check with preprocessing results as a background operation
      await updateCheck(
        checkId,
        {
          isAccessBlocked: isAccessBlocked,
          isVideo: isVideo,
          machineCategory: null,
          title: title,
          slug: slug,
        },
        checkCtx,
        this.ctx.waitUntil.bind(this.ctx)
      );

      // Step 3: Agent loop
      this.logger.info("Step 3: Running agent loop");
      const agentLoopResult = await runAgentLoop(
        {
          startingMessages: startingContent,
          intent: intent,
        },
        checkCtx
      );

      this.logger.info({ agentLoopResult }, "Agent loop result");

      isControversial = agentLoopResult.isControversial;
      const report = agentLoopResult.report;
      const sources = agentLoopResult.sources;

      longformReport = {
        en: report,
        cn: null,
        links: sources,
        timestamp: timestamp,
      };

      await updateCheck(
        checkId,
        {
          isControversial,
          longformResponse: {
            en: report,
            cn: null,
            ms: null,
            id: null,
            ta: null,
            links: sources,
            timestamp: timestamp,
          },
        },
        checkCtx,
        this.ctx.waitUntil.bind(this.ctx)
      );

      // Step 4: Summarize report
      this.logger.info("Step 4: Summarizing report");
      const summary = await summarizeReport(
        {
          startingMessages: startingContent,
          intent: intent,
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
      generationStatus = "completed";
      // Update check with completion results as a background operation
      await updateCheck(
        checkId,
        {
          generationStatus: generationStatus,
          shortformResponse: {
            en: summary,
            cn: translationChinese,
            ms: translationMalay,
            id: translationIndonesian,
            ta: translationTamil,
            downvoted: false,
            links: sources,
            timestamp: timestamp,
          },
        },
        checkCtx,
        this.ctx.waitUntil.bind(this.ctx)
      );

      communityNote = {
        en: summary,
        cn: translationChinese,
        ms: translationMalay,
        id: translationIndonesian,
        ta: translationTamil,
        links: agentLoopResult.sources,
        timestamp: timestamp,
      };
      const agentResponse: AgentResponse = {
        success: true,
        id: checkId,
        result: {
          report: {
            en: agentLoopResult.report,
            cn: null,
            ms: null,
            id: null,
            ta: null,
            links: agentLoopResult.sources,
            timestamp: timestamp,
          },
          generationStatus: generationStatus,
          communityNote: communityNote,
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

      //notify block
      try {
        sendCommunityNoteNotification(
          {
            id: checkId,
            replyId: notificationId,
            communityNote: communityNote,
          },
          checkCtx,
          this.ctx.waitUntil.bind(this.ctx)
        );
      } catch (error) {
        logger.error("Failed to send community note notification");
      }

      //Update submission with completed status
      this.ctx.waitUntil(
        this.env.DATABASE_SERVICE.updateSubmission(submissionId, {
          checkStatus: "completed",
        }).catch((error) => {
          this.logger.error("Failed to update submission");
          throw error;
        })
      );

      trace.update({
        output: agentResponse,
        tags: [
          this.env.ENVIRONMENT,
          "agent-generation",
          "cloudflare-workers",
          request.consumerName ?? "unknown consumer",
        ],
      });

      return agentResponse;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error({ error, errorMessage }, "Error in agent check");

      // Determine what type of error occurred based on error message or stack trace
      let errorType: ErrorType = "error";
      if (errorMessage.includes("preprocessing")) {
        errorType = "error-preprocessing";
      } else if (errorMessage.includes("agent loop")) {
        errorType = "error-agentLoop";
      } else if (errorMessage.includes("summarise")) {
        errorType = "error-summarization";
      } else if (errorMessage.includes("translate")) {
        errorType = "error-translation";
      } else {
        errorType = "error-other";
      }
      generationStatus = errorType;
      // Update check with error status as a background operation
      await updateCheck(
        checkId ?? "",
        {
          generationStatus: generationStatus,
        },
        checkCtx,
        this.ctx.waitUntil.bind(this.ctx)
      );

      //Update submission with error status
      this.ctx.waitUntil(
        this.env.DATABASE_SERVICE.updateSubmission(submissionId, {
          checkStatus: "error",
        }).catch((error) => {
          this.logger.error("Failed to update submission");
          throw error;
        })
      );
      //notify block
      try {
        sendCommunityNoteNotification(
          {
            id: checkId ?? "",
            replyId: notificationId,
            communityNote: null,
            isError: true,
          },
          checkCtx,
          this.ctx.waitUntil.bind(this.ctx)
        );
      } catch (error) {
        logger.error("Failed to send community note notification");
      }
      const errorReturn = {
        id: checkId ?? undefined,
        error: { message: errorMessage },
        success: false as const,
      };
      checkCtx.trace?.update({
        output: errorReturn,
        tags: [
          this.env.ENVIRONMENT,
          "agent-generation",
          "cloudflare-workers",
          "error",
          request.consumerName ?? "unknown consumer",
        ],
      });
      return errorReturn;
    } finally {
      // Trigger voting
      try {
        if (checkId) {
          await triggerVoting(
            {
              id: checkId,
              text: request.text ?? null,
              imageUrl: request.imageUrl ?? null,
              caption: request.caption ?? null,
              longformReport: longformReport,
              communityNote: communityNote,
            },
            checkCtx,
            this.ctx.waitUntil.bind(this.ctx)
          );
        }
      } catch (error) {
        this.logger.error({ error }, "Failed to trigger voting");
      }

      await langfuse.flushAsync();
      await sdk.shutdown();
    }
  }
}
