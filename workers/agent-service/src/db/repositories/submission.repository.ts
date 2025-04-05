import { MongoClient, ObjectId } from "mongodb";
import { createLogger } from "@workspace/shared-utils";
import { Submission } from "../../models";

export class SubmissionRepository {
  private logger = createLogger("submission-repository");

  constructor(private mongoClient: MongoClient) {}

  async insert(
    submission: Omit<Submission, "_id">
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const db = this.mongoClient.db("checkmate-core");
      const submissionsCollection = db.collection<Submission>("submissions");

      // Create new ID first
      const newId = new ObjectId();

      // Properly await the insertion
      await submissionsCollection.insertOne({
        ...submission,
        _id: newId,
      });

      return { success: true, id: newId.toString() };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error({ error, submission }, "Failed to insert submission");
      return { success: false, error: errorMessage };
    }
  }

  async findById(
    id: string
  ): Promise<{ success: boolean; data?: Submission; error?: string }> {
    try {
      const db = this.mongoClient.db("checkmate-core");
      const submissionsCollection = db.collection<Submission>("submissions");

      const submission = await submissionsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!submission) {
        return {
          success: false,
          error: `Submission with id ${id} not found`,
        };
      }

      return { success: true, data: submission };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error({ error, id }, "Failed to find submission");
      return { success: false, error: errorMessage };
    }
  }

  async update(
    id: string,
    data: Partial<Omit<Submission, "_id">>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const db = this.mongoClient.db("checkmate-core");
      const submissionsCollection = db.collection<Submission>("submissions");

      const result = await submissionsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: data }
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
      this.logger.error(
        { error, errorMessage, id, data },
        "Failed to update submission"
      );
      return { success: false, error: errorMessage };
    }
  }

  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const db = this.mongoClient.db("checkmate-core");
      const submissionsCollection = db.collection<Submission>("submissions");

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
}
