import { MongoClient, ObjectId } from "mongodb";
import { createLogger } from "@workspace/shared-utils";
import { Check } from "../../models";

export class CheckRepository {
  private logger = createLogger("check-repository");

  constructor(private mongoClient: MongoClient) {}

  async insert(
    check: Omit<Check, "_id">,
    customId?: ObjectId
  ): Promise<{ success: boolean; error?: string; id?: string }> {
    try {
      const db = this.mongoClient.db("checkmate-core");
      const checksCollection = db.collection<Check>("checks");

      const objectId = customId || new ObjectId();
      await checksCollection.insertOne({
        ...check,
        _id: objectId,
      });

      return { success: true, id: objectId.toString() };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error({ error, check }, "Failed to insert check");
      return { success: false, error: errorMessage };
    }
  }

  async findById(
    id: string
  ): Promise<{ success: boolean; data?: Check; error?: string }> {
    try {
      const db = this.mongoClient.db();
      const checksCollection = db.collection<Check>("checks");

      const check = await checksCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!check) {
        return {
          success: false,
          error: `Check with id ${id} not found`,
        };
      }

      return { success: true, data: check };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error({ error, id }, "Failed to find check");
      return { success: false, error: errorMessage };
    }
  }

  async update(
    id: string,
    data: Partial<Omit<Check, "_id">>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const db = this.mongoClient.db();
      const checksCollection = db.collection<Check>("checks");

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

  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const db = this.mongoClient.db();
      const checksCollection = db.collection<Check>("checks");

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
}
