/**
 * Database Service Worker
 *
 * This worker handles database operations for the Checkmate application.
 * Each method creates a new connection, performs its task, and closes the connection.
 */
import { MongoClient, ObjectId } from "mongodb";

import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";
import { Check, Submission } from "@workspace/shared-types";

// Shared logger
const logger = createLogger("database-service");

// Import types from models
// Main worker class for health checks
export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("database-service");

  async fetch(request: Request): Promise<Response> {
    try {
      // Simple health check endpoint
      return new Response(
        JSON.stringify({ status: "healthy", service: "database-service" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      this.logger.error({ error }, "Error handling health check request");
      return new Response(
        JSON.stringify({ success: false, error: "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  async insertCheck(
    check: Omit<Check, "_id">,
    customId?: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      const db = client.db("checkmate-core");
      const checksCollection = db.collection("checks");

      const objectId = customId ? new ObjectId(customId) : new ObjectId();
      const idString = objectId.toString();

      await checksCollection.insertOne({
        ...check,
        _id: objectId,
      });

      return { success: true, id: idString };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, errorMessage, check }, "Failed to insert check");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }

  async findCheckById(
    id: string
  ): Promise<{ success: boolean; data?: Check; error?: string }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      const db = client.db("checkmate-core");
      const checksCollection = db.collection("checks");

      const check = await checksCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!check) {
        return {
          success: false,
          error: `Check with id ${id} not found`,
        };
      }

      // Convert _id to string for the external interface
      return {
        success: true,
        data: {
          ...check,
          _id: check._id.toString(),
        } as Check,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, id }, "Failed to find check");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }

  async findCheckByTextHash(
    textHash: string
  ): Promise<{ success: boolean; data?: Check; error?: string }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      const db = client.db("checkmate-core");
      const checksCollection = db.collection("checks");

      const check = await checksCollection.findOne({
        textHash: textHash,
      });

      if (!check) {
        return {
          success: false,
          error: `Check with textHash ${textHash} not found`,
        };
      }

      // Convert _id to string for the external interface
      return {
        success: true,
        data: {
          ...check,
          _id: check._id.toString(),
        } as Check,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, textHash }, "Failed to find check by text hash");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }

  async updateCheck(
    id: string,
    data: Partial<Omit<Check, "_id">>
  ): Promise<{ success: boolean; error?: string }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      const db = client.db("checkmate-core");
      const checksCollection = db.collection("checks");

      const result = await checksCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: data }
      );

      if (result.matchedCount === 0) {
        return {
          success: false,
          error: `Check with id ${id} not found`,
        };
      }

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, id, data }, "Failed to update check");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }

  async deleteCheck(id: string): Promise<{ success: boolean; error?: string }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      const db = client.db("checkmate-core");
      const checksCollection = db.collection("checks");

      const result = await checksCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount === 0) {
        return {
          success: false,
          error: `Check with id ${id} not found`,
        };
      }

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, id }, "Failed to delete check");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }

  // Submission methods
  async insertSubmission(submission: Omit<Submission, "_id">): Promise<{
    success: boolean;
    id?: string;
    checkId?: string;
    error?: string;
  }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      const db = client.db("checkmate-core");
      const submissionsCollection = db.collection("submissions");

      const newId = new ObjectId();
      const idString = newId.toString();

      // Convert checkId from string to ObjectId if it exists
      const checkIdAsObjectId = submission.checkId
        ? new ObjectId(submission.checkId)
        : new ObjectId();

      await submissionsCollection.insertOne({
        ...submission,
        _id: newId,
        checkId: checkIdAsObjectId,
      });

      return {
        success: true,
        id: idString,
        checkId: checkIdAsObjectId.toString(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, submission }, "Failed to insert submission");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }

  async findSubmissionById(
    id: string
  ): Promise<{ success: boolean; data?: Submission; error?: string }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      const db = client.db("checkmate-core");
      const submissionsCollection = db.collection("submissions");

      const submission = await submissionsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!submission) {
        return {
          success: false,
          error: `Submission with id ${id} not found`,
        };
      }

      // Convert _id and checkId to strings for the external interface
      return {
        success: true,
        data: {
          ...submission,
          _id: submission._id.toString(),
          checkId: submission.checkId ? submission.checkId.toString() : null,
        } as Submission,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, id }, "Failed to find submission");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }

  async updateSubmission(
    id: string,
    data: Partial<Omit<Submission, "_id">>
  ): Promise<{ success: boolean; error?: string }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      const db = client.db("checkmate-core");
      const submissionsCollection = db.collection("submissions");

      // Handle checkId conversion if it's being updated
      const updateData = { ...data };
      if (updateData.checkId) {
        updateData.checkId = new ObjectId(
          updateData.checkId
        ) as unknown as string;
      }

      const result = await submissionsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        return {
          success: false,
          error: `Submission with id ${id} not found`,
        };
      }

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, id, data }, "Failed to update submission");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }

  async deleteSubmission(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      const db = client.db("checkmate-core");
      const submissionsCollection = db.collection("submissions");

      const result = await submissionsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount === 0) {
        return {
          success: false,
          error: `Submission with id ${id} not found`,
        };
      }

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, id }, "Failed to delete submission");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }

  // Add method to find submissions by checkId
  async findSubmissionsByCheckId(
    checkId: string
  ): Promise<{ success: boolean; data?: Submission[]; error?: string }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      const db = client.db("checkmate-core");
      const submissionsCollection = db.collection("submissions");

      const submissions = await submissionsCollection
        .find({ checkId: new ObjectId(checkId) })
        .toArray();

      // Convert _id and checkId to strings for all submissions
      const convertedSubmissions = submissions.map((submission) => ({
        ...submission,
        _id: submission._id.toString(),
        checkId: submission.checkId ? submission.checkId.toString() : null,
      })) as Submission[];

      return { success: true, data: convertedSubmissions };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error, checkId }, "Failed to find submissions by checkId");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }

  // Vector search for similar checks
  async vectorSearch(
    embedding: number[],
    limit: number = 5
  ): Promise<{
    success: boolean;
    data?: Array<
      Pick<
        Check,
        "text" | "timestamp" | "shortformResponse" | "crowdsourcedCategory"
      > & {
        id: string;
        score: number;
      }
    >;
    error?: string;
  }> {
    const client = new MongoClient(this.env.MONGODB_CONNECTION_STRING);
    try {
      if (embedding.length !== 384) {
        return {
          success: false,
          error: "Embedding must be 384 dimensions",
        };
      }

      const db = client.db("checkmate-core");
      const checksCollection = db.collection("checks");

      const filter: Partial<Pick<Check, "isExpired" | "isHumanAssessed">> = {
        isExpired: false,
      };

      if (this.env.ENVIRONMENT === "production") {
        filter.isHumanAssessed = true;
      }

      const pipeline = [
        {
          $vectorSearch: {
            index: "text-embedding-index",
            queryVector: embedding,
            path: "embeddings.text",
            numCandidates: limit * 10,
            limit: limit,
            filter: filter,
          },
        },
        {
          $project: {
            _id: 1,
            text: 1,
            timestamp: 1,
            shortformResponse: 1,
            crowdsourcedCategory: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ];

      const results = await checksCollection.aggregate(pipeline).toArray();

      const formattedResults = results.map((result) => ({
        id: result._id.toString(),
        text: result.text || "",
        timestamp: result.timestamp,
        shortformResponse: result.shortformResponse || {},
        crowdsourcedCategory: result.crowdsourcedCategory || null,
        score: result.score,
      }));

      return { success: true, data: formattedResults };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error({ error }, "Failed to perform vector search");
      return { success: false, error: errorMessage };
    } finally {
      await client.close();
    }
  }
}
