import { WorkerEntrypoint } from "cloudflare:workers";
import {
  createLogger,
  getGoogleAuthToken,
  getProviderFromModel,
} from "@workspace/shared-utils";
import { Langfuse, observeOpenAI } from "langfuse";
import { createClient } from "@workspace/shared-llm-client";

// Define the structure for the digest result
interface DigestResult {
  full_digest: string;
  truncated_digest: string;
}


export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("digest-service");
  private logContext: Record<string, any> = {};

  async fetch(request: Request): Promise<Response> {
    this.logContext = { traceId: crypto.randomUUID() }; // Add traceId for logging
    try {
      // Call createDigest to generate the digests
      const digestResult = await this.createDigest();
      this.logger.info(this.logContext, "Digest generation complete");

      return new Response(JSON.stringify({ success: true, data: digestResult }), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      this.logger.error(this.logContext, "Error in fetch:", error);
      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }
  }

  async fetchDataFromBigQuery(query: string) {
    const accessToken = await getGoogleAuthToken(
      this.env.GOOGLE_CLIENT_ID, // service account email
      this.env.GOOGLE_CLIENT_SECRET, // private key
      "https://www.googleapis.com/auth/bigquery"
    );

    // Define the variables needed for the query
    const project_id = this.env.GOOGLE_PROJECT_ID;
    const bqEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${project_id}/queries`;

    const requestBody = {
      query: query,
      location: "asia-southeast1",
      useLegacySql: false,
      useQueryCache: true,
    };

    const response = await fetch(bqEndpoint, {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorJson: any;
      try {
        errorJson = JSON.parse(errorText);
        this.logger.error(
          this.logContext,
          `BigQuery API error: ${response.status} ${response.statusText}`,
          errorJson
        );
        throw new Error(
          `BigQuery API error: ${response.status} ${
            errorJson?.error?.message || errorText
          }`
        );
      } catch (e) {
        this.logger.error(
          this.logContext,
          `BigQuery API error: ${response.status} ${response.statusText}`,
          errorText
        );
        throw new Error(`BigQuery API error: ${response.status} ${errorText}`);
      }
    }

    const responseData = (await response.json()) as any;

    if (responseData.jobComplete === false && responseData.jobReference) {
      this.logger.info(
        this.logContext,
        "Job not complete, polling for results"
      );
      return await this.pollBigQueryResults(
        responseData.jobReference,
        accessToken
      );
    }

    return responseData;
  }

  async pollBigQueryResults(
    jobReference: { projectId: string; jobId: string; location: string },
    accessToken: string,
    maxAttempts = 10
  ) {
    const { projectId, jobId, location } = jobReference;
    const pollEndpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs/${jobId}/getQueryResults`;

    this.logger.info(this.logContext, `Polling for results: ${pollEndpoint}`);

    // Poll with exponential backoff
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Wait with exponential backoff (1s, 2s, 4s, 8s, ...)
      const delay = Math.pow(2, attempt) * 1000;
      this.logger.info(
        this.logContext,
        `Waiting ${delay}ms before polling (attempt ${
          attempt + 1
        }/${maxAttempts})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));

      const pollResponse = await fetch(`${pollEndpoint}?location=${location}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text();
        this.logger.error(this.logContext, "Poll error:", errorText);
        continue;
      }

      const pollData = (await pollResponse.json()) as any;
      this.logger.info(
        this.logContext,
        "Poll response received:",
        pollData.jobComplete ? "complete" : "still running"
      );

      // If job is complete, return the results
      if (pollData.jobComplete === true) {
        return pollData;
      }
    }

    throw new Error(
      `BigQuery job did not complete after ${maxAttempts} polling attempts`
    );
  }

  async createDigest(): Promise<DigestResult> {
    this.logger.info(this.logContext, "Starting digest generation process");

    let langfuse: Langfuse | undefined;
    const defaultDigestResult: DigestResult = {
      full_digest: "No recent data found in BigQuery to generate a digest.",
      truncated_digest: "No recent data found in BigQuery to generate a digest.",
    };

    try {
      // 1. Initialize Langfuse
      const model = "gpt-4.1";
      const provider = getProviderFromModel(model);
      langfuse = new Langfuse({
        environment: this.env.ENVIRONMENT,
        publicKey: this.env.LANGFUSE_PUBLIC_KEY,
        secretKey: this.env.LANGFUSE_SECRET_KEY,
        baseUrl: this.env.LANGFUSE_HOST,
      });

      // 2. Fetch data from BigQuery
      const project_id = this.env.GOOGLE_PROJECT_ID;
      const dataset_id = "checkmate_export";
      const table_id = "messages_reporting_view";
      const start_date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      const end_date = new Date();
      const query = `
          SELECT originalText
          FROM \`${project_id}.${dataset_id}.${table_id}\`
          WHERE firstTimestamp >= TIMESTAMP('${start_date.toISOString()}')
            AND firstTimestamp < TIMESTAMP('${end_date.toISOString()}')
            AND originalText IS NOT NULL
            AND primaryCategory != "trivial"
      `;

      this.logger.info(this.logContext, "Fetching data from BigQuery...");
      const data = await this.fetchDataFromBigQuery(query);
      this.logger.info(
        this.logContext,
        `Fetched ${data.rows?.length ?? 0} entries from BigQuery.`
      );

      // 3. Process BigQuery results
      const texts: string[] =
        data.rows
          ?.map((row: { f?: { v: any }[] }) => row.f?.[0]?.v) // Added type for row
          .filter((text: unknown): text is string => typeof text === "string") ?? [];

      if (texts.length === 0) {
        this.logger.warn(this.logContext, "No text data found for digest.");
        return defaultDigestResult;
      }

      const combined_text = texts.join("\n---\n");
      this.logger.info(
        this.logContext,
        `Combined text length: ${combined_text.length} characters.`
      );

      // 4. Setup Langfuse Trace
      const trace = langfuse.trace({
        name: "create-digest",
        input: { query_dates: { start: start_date.toISOString(), end: end_date.toISOString() }, text_count: texts.length },
        id: this.logContext.traceId || crypto.randomUUID(),
        metadata: {
          provider: provider,
          model: model,
        },
      });

      // 5. Fetch Langfuse Prompts
      this.logger.info(this.logContext, "Fetching prompts from Langfuse...");
      const langfuseLabel =
        this.env.ENVIRONMENT === "production"
          ? "cf-production"
          : this.env.ENVIRONMENT;

      const digestSystemPrompt = await langfuse.getPrompt(
        "generate_digest",
        undefined,
        { label: langfuseLabel, type: "text" }
      );
      const shortenDigestPrompt = await langfuse.getPrompt(
        "generate_digest_shorten",
        undefined,
        { label: langfuseLabel, type: "text" }
      );
      this.logger.info(this.logContext, "Prompts fetched successfully.");

      // Extract config safely
      const digestConfig = digestSystemPrompt.config ?? {};
      const shortenConfig = shortenDigestPrompt.config ?? {};


      // 6. Initialize LLM Client
      const client = await createClient(provider, this.env);

      const observedClient = observeOpenAI(client, {
        clientInitParams: {
          publicKey: this.env.LANGFUSE_PUBLIC_KEY,
          secretKey: this.env.LANGFUSE_SECRET_KEY,
          baseUrl: this.env.LANGFUSE_HOST,
        },
        parent: trace,
      });

      // 7. Generate Full Digest
      this.logger.info(this.logContext, "Generating full digest...");
      const fullDigestMessages = [
        { role: "system", content: digestSystemPrompt.prompt },
        {
          role: "user",
          content: `Here is the collection of text snippets reported in the last week:\n\n${combined_text}`,
        },
      ];

      const fullDigestResponse = await observedClient.chat.completions.create(
        {
          model: digestConfig.model ?? "gpt-4o",
          temperature: digestConfig.temperature ?? 0.2,
          seed: digestConfig.seed || 11,
          max_tokens: 1000,
          messages: fullDigestMessages,
        },
        { langfusePrompt: digestSystemPrompt }
      );

      let full_digest = fullDigestResponse.choices[0].message.content ?? "";
      this.logger.info(
        this.logContext,
        `Full digest generated (length: ${full_digest.length} chars).`
      );

      let truncated_digest = "";

      // 8. Generate Truncated Digest (if needed)
      if (full_digest.length > 1024) {
        this.logger.info(
          this.logContext,
          "Full digest exceeds 1024 chars. Generating summarized version..."
        );
        const shortenMessages = [
          { role: "system", content: "You are a summarization assistant." },
          {
            role: "user",
            content: shortenDigestPrompt.compile({ text_to_summarize: full_digest }),
          },
        ];

        const shortenResponse = await observedClient.chat.completions.create(
          {
            model: shortenConfig.model ?? "gpt-4o-mini", // Use mini for summarization?
            temperature: shortenConfig.temperature ?? 0.2,
            max_tokens: 350,
            messages: shortenMessages,
          },
          { langfusePrompt: shortenDigestPrompt }
        );

        let summarized_digest = shortenResponse.choices[0].message.content ?? "";

        if (summarized_digest.length > 1024) {
          this.logger.warn(
            this.logContext,
            "Summarized digest still exceeded 1024 chars. Truncating."
          );
          truncated_digest = summarized_digest.substring(0, 1024);
        } else {
          truncated_digest = summarized_digest;
        }
        this.logger.info(
          this.logContext,
          `Summarized digest generated (length: ${truncated_digest.length} chars).`
        );
      } else {
        this.logger.info(
          this.logContext,
          "Full digest is within 1024 chars. No summarization needed."
        );
        truncated_digest = full_digest;
      }

      // 9. Finalize and Update Trace
      const finalResult: DigestResult = { full_digest, truncated_digest };
      trace.update({
        output: finalResult,
        tags: [
          this.env.ENVIRONMENT,
          "digest-generation",
          "cloudflare-workers",
          `texts:${texts.length}`,
        ],
      });

      return finalResult;

    } catch (error) {
      this.logger.error(
        { ...this.logContext, error },
        "Error generating digest"
      );
      // Log error to trace if langfuse is available
      if (langfuse) {
         const traceId = this.logContext.traceId || 'unknown-trace'; // Get traceId if available
         const errorTrace = langfuse.trace({ // Create a separate trace for the error? Or update existing?
             name: "create-digest-error",
             id: `${traceId}-error`,
             input: this.logContext,
             output: { error: error instanceof Error ? error.message : String(error) },
             level: "ERROR",
             tags: [this.env.ENVIRONMENT, "error", "digest-generation"]
         });
         this.ctx.waitUntil(errorTrace.flushAsync()); // Ensure error trace is flushed
      }
      return {
        full_digest: `Error: Failed to generate digest. ${error instanceof Error ? error.message : String(error)}`,
        truncated_digest: `Error: Failed to generate digest. ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      if (langfuse) {
        this.ctx.waitUntil(langfuse.flushAsync());
      }
    }
  }
}
