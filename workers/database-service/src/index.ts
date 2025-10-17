/**
 * Database Service Worker with Durable Objects for Connection Pooling
 *
 * This worker handles database operations for the Checkmate application.
 * Uses Durable Objects to maintain persistent MongoDB connections for improved performance.
 */
import { MongoClient, ObjectId } from "mongodb";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";
import { Check, Submission } from "@workspace/shared-types";

// Shared logger
const logger = createLogger("database-service");

/**
 * DatabaseDurableObject maintains a persistent MongoDB connection
 * This significantly improves performance by avoiding connection overhead
 */
export class DatabaseDurableObject extends DurableObject<Env> {
  private client: MongoClient;
  private logger = createLogger("database-durable-object");
  private connectPromise: Promise<MongoClient>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.client = new MongoClient(env.MONGODB_CONNECTION_STRING);
    // Store the connection promise to await in each method
    this.connectPromise = this.client.connect();
  }

  async insertCheck(
    check: Omit<Check, "_id">,
    customId?: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
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
      this.logger.error(
        { error, errorMessage, check },
        "Failed to insert check"
      );
      return { success: false, error: errorMessage };
    }
  }

  async findCheckById(
    id: string
  ): Promise<{ success: boolean; data?: Check; error?: string }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
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
      this.logger.error({ error, id }, "Failed to find check");
      return { success: false, error: errorMessage };
    }
  }

  async findCheckByTextHash(
    textHash: string
  ): Promise<{ success: boolean; data?: Check; error?: string }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
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
      this.logger.error(
        { error, textHash },
        "Failed to find check by text hash"
      );
      return { success: false, error: errorMessage };
    }
  }

  async findCheckByImageHash(
    imageHash: string
  ): Promise<{ success: boolean; data?: Check; error?: string }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
      const checksCollection = db.collection("checks");

      const check = await checksCollection.findOne({
        imageHash: imageHash,
      });

      if (!check) {
        return {
          success: false,
          error: `Check with imageHash ${imageHash} not found`,
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
      this.logger.error(
        { error, imageHash },
        "Failed to find check by image hash"
      );
      return { success: false, error: errorMessage };
    }
  }

  async updateCheck(
    id: string,
    data: Partial<Omit<Check, "_id">>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
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
      this.logger.error({ error, id, data }, "Failed to update check");
      return { success: false, error: errorMessage };
    }
  }

  async updateCheckWithChanges(
    id: string,
    data: Partial<Omit<Check, "_id">> & Record<string, any>
  ): Promise<{
    success: boolean;
    error?: string;
    changes?: {
      becameHumanAssessed: boolean;
      becameDownvoted: boolean;
    };
  }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
      const checksCollection = db.collection("checks");

      // Get the document before update atomically
      const result = await checksCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: data },
        { returnDocument: "before" }
      );

      if (!result) {
        return {
          success: false,
          error: `Check with id ${id} not found`,
        };
      }

      const oldDoc = result as any;

      // Calculate what changed
      const changes = {
        becameHumanAssessed:
          !oldDoc.isHumanAssessed && data.isHumanAssessed === true,
        becameDownvoted:
          !oldDoc.shortformResponse?.downvoted &&
          data["shortformResponse.downvoted"] === true,
      };

      return { success: true, changes };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error({ error, id, data }, "Failed to update check with changes");
      return { success: false, error: errorMessage };
    }
  }

  async deleteCheck(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
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
      this.logger.error({ error, id }, "Failed to delete check");
      return { success: false, error: errorMessage };
    }
  }

  // Submission methods
  async insertSubmission(submission: Omit<Submission, "_id">): Promise<{
    success: boolean;
    id?: string;
    checkId?: string;
    error?: string;
  }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
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
      this.logger.error({ error, submission }, "Failed to insert submission");
      return { success: false, error: errorMessage };
    }
  }

  async findSubmissionById(
    id: string
  ): Promise<{ success: boolean; data?: Submission; error?: string }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
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
      this.logger.error({ error, id }, "Failed to find submission");
      return { success: false, error: errorMessage };
    }
  }

  async updateSubmission(
    id: string,
    data: Partial<Omit<Submission, "_id">>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
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
      this.logger.error({ error, id, data }, "Failed to update submission");
      return { success: false, error: errorMessage };
    }
  }

  async deleteSubmission(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
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
      this.logger.error({ error, id }, "Failed to delete submission");
      return { success: false, error: errorMessage };
    }
  }

  async findSubmissionsByCheckId(
    checkId: string
  ): Promise<{ success: boolean; data?: Submission[]; error?: string }> {
    try {
      await this.connectPromise;
      const db = this.client.db("checkmate-core");
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
      this.logger.error(
        { error, checkId },
        "Failed to find submissions by checkId"
      );
      return { success: false, error: errorMessage };
    }
  }

  // Vector search for similar checks by text embedding
  async findSimilarTextEmbedding(
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
    try {
      await this.connectPromise;
      if (embedding.length !== 384) {
        return {
          success: false,
          error: "Embedding must be 384 dimensions",
        };
      }

      const db = this.client.db("checkmate-core");
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
      this.logger.error({ error }, "Failed to perform text embedding vector search");
      return { success: false, error: errorMessage };
    }
  }

  // Vector search for similar checks by caption embedding
  async findSimilarCaptionEmbedding(
    embedding: number[],
    limit: number = 5
  ): Promise<{
    success: boolean;
    data?: Array<
      Pick<
        Check,
        "caption" | "imageUrl" | "imageHash" | "timestamp" | "shortformResponse" | "crowdsourcedCategory"
      > & {
        id: string;
        score: number;
      }
    >;
    error?: string;
  }> {
    try {
      await this.connectPromise;
      if (embedding.length !== 384) {
        return {
          success: false,
          error: "Embedding must be 384 dimensions",
        };
      }

      const db = this.client.db("checkmate-core");
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
            index: "caption-embedding-index",
            queryVector: embedding,
            path: "embeddings.caption",
            numCandidates: limit * 10,
            limit: limit,
            filter: filter,
          },
        },
        {
          $project: {
            _id: 1,
            caption: 1,
            imageUrl: 1,
            imageHash: 1,
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
        caption: result.caption || "",
        imageUrl: result.imageUrl || null,
        imageHash: result.imageHash || null,
        timestamp: result.timestamp,
        shortformResponse: result.shortformResponse || {},
        crowdsourcedCategory: result.crowdsourcedCategory || null,
        score: result.score,
      }));

      return { success: true, data: formattedResults };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error({ error }, "Failed to perform caption embedding vector search");
      return { success: false, error: errorMessage };
    }
  }

  // Vector search for similar images by PDQ hash embedding (256-dim binary vector)
  async findSimilarImageEmbedding(
    embedding: number[],
    limit: number = 5
  ): Promise<{
    success: boolean;
    data?: Array<
      Pick<
        Check,
        "imageUrl" | "caption" | "imageHash" | "timestamp" | "shortformResponse" | "crowdsourcedCategory"
      > & {
        id: string;
        distance: number;
      }
    >;
    error?: string;
  }> {
    try {
      await this.connectPromise;
      if (embedding.length !== 256) {
        return {
          success: false,
          error: "PDQ embedding must be 256 dimensions",
        };
      }

      const db = this.client.db("checkmate-core");
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
            index: "pdq-embedding-index",
            queryVector: embedding,
            path: "embeddings.pdq",
            numCandidates: limit * 10,
            limit: limit,
            filter: filter,
          },
        },
        {
          $project: {
            _id: 1,
            imageUrl: 1,
            caption: 1,
            imageHash: 1,
            timestamp: 1,
            shortformResponse: 1,
            crowdsourcedCategory: 1,
            distance: { $meta: "vectorSearchScore" },
          },
        },
      ];

      // First, check how many documents have PDQ embeddings
      const totalWithPDQ = await checksCollection.countDocuments({
        "embeddings.pdq": { $exists: true, $ne: null },
      });

      const totalNotExpired = await checksCollection.countDocuments({
        isExpired: false,
        "embeddings.pdq": { $exists: true, $ne: null },
      });

      const results = await checksCollection.aggregate(pipeline).toArray();

      this.logger.info(
        {
          requestedLimit: limit,
          numCandidates: limit * 10,
          resultsReturned: results.length,
          totalWithPDQ,
          totalNotExpired,
          filter,
          environment: this.env.ENVIRONMENT,
        },
        "PDQ vector search completed"
      );

      const formattedResults = results.map((result) => ({
        id: result._id.toString(),
        imageUrl: result.imageUrl || null,
        caption: result.caption || null,
        imageHash: result.imageHash || null,
        timestamp: result.timestamp,
        shortformResponse: result.shortformResponse || {},
        crowdsourcedCategory: result.crowdsourcedCategory || null,
        distance: result.distance,
      }));

      return { success: true, data: formattedResults };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error({ error }, "Failed to perform image embedding vector search");
      return { success: false, error: errorMessage };
    }
  }
}

// Main worker class that routes requests through Durable Object
export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("database-service");

  // Get or create a Durable Object instance
  private getDurableObject() {
    // Use a consistent ID for the database connection pool
    const id = this.env.DATABASE_DURABLE_OBJECT.idFromName("mongodb-pool");
    return this.env.DATABASE_DURABLE_OBJECT.get(id);
  }

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

  // Delegate all database methods to the Durable Object
  async insertCheck(
    check: Omit<Check, "_id">,
    customId?: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    const durableObject = this.getDurableObject();
    return durableObject.insertCheck(check, customId);
  }

  async findCheckById(
    id: string
  ): Promise<{ success: boolean; data?: Check; error?: string }> {
    const durableObject = this.getDurableObject();
    return durableObject.findCheckById(id);
  }

  async findCheckByTextHash(
    textHash: string
  ): Promise<{ success: boolean; data?: Check; error?: string }> {
    const durableObject = this.getDurableObject();
    return durableObject.findCheckByTextHash(textHash);
  }

  async findCheckByImageHash(
    imageHash: string
  ): Promise<{ success: boolean; data?: Check; error?: string }> {
    const durableObject = this.getDurableObject();
    return durableObject.findCheckByImageHash(imageHash);
  }

  async updateCheck(
    id: string,
    data: Partial<Omit<Check, "_id">>
  ): Promise<{ success: boolean; error?: string }> {
    const durableObject = this.getDurableObject();
    return durableObject.updateCheck(id, data);
  }

  async updateCheckWithChanges(
    id: string,
    data: Partial<Omit<Check, "_id">> & Record<string, any>
  ): Promise<{
    success: boolean;
    error?: string;
    changes?: {
      becameHumanAssessed: boolean;
      becameDownvoted: boolean;
    };
  }> {
    const durableObject = this.getDurableObject();
    return durableObject.updateCheckWithChanges(id, data);
  }

  async deleteCheck(id: string): Promise<{ success: boolean; error?: string }> {
    const durableObject = this.getDurableObject();
    return durableObject.deleteCheck(id);
  }

  async insertSubmission(submission: Omit<Submission, "_id">): Promise<{
    success: boolean;
    id?: string;
    checkId?: string;
    error?: string;
  }> {
    const durableObject = this.getDurableObject();
    return durableObject.insertSubmission(submission);
  }

  async findSubmissionById(
    id: string
  ): Promise<{ success: boolean; data?: Submission; error?: string }> {
    const durableObject = this.getDurableObject();
    return durableObject.findSubmissionById(id);
  }

  async updateSubmission(
    id: string,
    data: Partial<Omit<Submission, "_id">>
  ): Promise<{ success: boolean; error?: string }> {
    const durableObject = this.getDurableObject();
    return durableObject.updateSubmission(id, data);
  }

  async deleteSubmission(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    const durableObject = this.getDurableObject();
    return durableObject.deleteSubmission(id);
  }

  async findSubmissionsByCheckId(
    checkId: string
  ): Promise<{ success: boolean; data?: Submission[]; error?: string }> {
    const durableObject = this.getDurableObject();
    return durableObject.findSubmissionsByCheckId(checkId);
  }

  async findSimilarTextEmbedding(
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
    const durableObject = this.getDurableObject();
    return durableObject.findSimilarTextEmbedding(embedding, limit);
  }

  async findSimilarCaptionEmbedding(
    embedding: number[],
    limit: number = 5
  ): Promise<{
    success: boolean;
    data?: Array<
      Pick<
        Check,
        "caption" | "imageUrl" | "imageHash" | "timestamp" | "shortformResponse" | "crowdsourcedCategory"
      > & {
        id: string;
        score: number;
      }
    >;
    error?: string;
  }> {
    const durableObject = this.getDurableObject();
    return durableObject.findSimilarCaptionEmbedding(embedding, limit);
  }

  async findSimilarImageEmbedding(
    embedding: number[],
    limit: number = 5
  ): Promise<{
    success: boolean;
    data?: Array<
      Pick<
        Check,
        "imageUrl" | "caption" | "imageHash" | "timestamp" | "shortformResponse" | "crowdsourcedCategory"
      > & {
        id: string;
        distance: number;
      }
    >;
    error?: string;
  }> {
    const durableObject = this.getDurableObject();
    return durableObject.findSimilarImageEmbedding(embedding, limit);
  }
}
