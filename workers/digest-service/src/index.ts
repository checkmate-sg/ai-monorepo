import { WorkerEntrypoint } from "cloudflare:workers";
import {
  createLogger,
  getGoogleAuthToken,
  getProviderFromModel,
} from "@workspace/shared-utils";
import { Langfuse, observeOpenAI } from "langfuse";
import { createClient } from "@workspace/shared-llm-client";

const configObject = {
  //TODO: can change
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
  private logger = createLogger("digest-service");
  private logContext: Record<string, any> = {};

  async fetch(request: Request): Promise<Response> {
    try {
      const data = await this.createDigest(true);
      this.logger.info(this.logContext, "BigQuery data received");

      // Parse the results if they exist
      let results = [];
      if (data.rows && Array.isArray(data.rows)) {
        results = data.rows
          .map((row: any) => {
            // Convert BigQuery row format to simple objects
            if (row.f && Array.isArray(row.f)) {
              // Get the originalText value from the first field
              return row.f[0]?.v;
            }
            return null;
          })
          .filter(Boolean); // Remove any null values
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: results,
          totalRows: data.totalRows || 0,
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
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
    const project_id = this.env.GOOGLE_PROJECT_ID; // Replace with your actual project ID or environment variable
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

      try {
        const errorJson = JSON.parse(errorText);
      } catch (e) {
        // If not JSON, use the text as is
      }
    }

    const responseData = (await response.json()) as any;

    // Check if job is not complete yet
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

  async createDigest(test: boolean = false) {
    this.logger.info(
      this.logContext,
      "Received needs checking assessment request"
    );

    let langfuse: Langfuse | undefined;
    const project_id = this.env.GOOGLE_PROJECT_ID;
    const dataset_id = "checkmate_export"; // Replace with your actual dataset ID or environment variable
    const table_id = "messages_reporting_view"; // Replace with your actual table ID or environment variable
    const start_date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const end_date = new Date(); // current date
    const query = `
        SELECT originalText
        FROM \`${project_id}.${dataset_id}.${table_id}\`
        WHERE firstTimestamp >= TIMESTAMP('${start_date.toISOString()}')
          AND firstTimestamp < TIMESTAMP('${end_date.toISOString()}')
          AND originalText IS NOT NULL
          AND (primaryCategory = "scam" OR primaryCategory = "misleading")
    `;

    const data = await this.fetchDataFromBigQuery(query);

    if (test) {
      return data;
    }

    try {
      const model = "gemini-2.5";
      const provider = getProviderFromModel(model);
      langfuse = new Langfuse({
        environment: this.env.ENVIRONMENT,
        publicKey: this.env.LANGFUSE_PUBLIC_KEY,
        secretKey: this.env.LANGFUSE_SECRET_KEY,
        baseUrl: this.env.LANGFUSE_HOST,
      });

      if (!langfuse) {
        this.logger.error(this.logContext, "Langfuse is not configured");
      }

      const trace = langfuse.trace({
        name: "create-digest",
        input: "TODO",
        id: crypto.randomUUID(),
        metadata: {
          provider: provider,
        },
      });

      const needsCheckingPrompt = await langfuse.getPrompt("TODO", undefined, {
        //TODO: update
        label: this.env.ENVIRONMENT,
        type: "chat",
      });

      // Compile the prompt with the report and formatted sources
      const config = needsCheckingPrompt.config as typeof configObject; //TODO: update
      const messages = needsCheckingPrompt.compile({
        //TODO: update
        message: "TODO",
      });

      const client = await createClient(provider, this.env);

      const observedClient = observeOpenAI(client, {
        clientInitParams: {
          publicKey: this.env.LANGFUSE_PUBLIC_KEY,
          secretKey: this.env.LANGFUSE_SECRET_KEY,
          baseUrl: this.env.LANGFUSE_HOST,
        },
        langfusePrompt: needsCheckingPrompt, //TODO: update
        parent: trace,
      });

      this.logger.info(this.logContext, "Calling LLM api");

      const response = await observedClient.chat.completions.create({
        //TODO: update
        model: config.model || "gpt-4o",
        temperature: config.temperature || 0,
        seed: config.seed || 11,
        messages: messages as any[],
        response_format: config.response_format,
      });

      const content = response.choices[0].message.content || "{}"; //TODO: update
      const result = JSON.parse(content);
      if ("needs_checking" in result) {
        const returnObject = {
          success: true,
          result: {
            needsChecking: result.needs_checking,
          },
          id: "TODO",
        };
        trace.update({
          output: returnObject,
          tags: [
            this.env.ENVIRONMENT,
            "single-call",
            "digest-generation",
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
        id: "TODO",
        success: false,
      };
    } finally {
      if (langfuse) {
        this.ctx.waitUntil(langfuse.flushAsync());
      }
    }
  }
}
