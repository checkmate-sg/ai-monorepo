import { MongoClient } from "mongodb";
import { createLogger } from "@workspace/shared-utils";
import { SubmissionRepository } from "./repositories/submission.repository";
import { CheckRepository } from "./repositories/checks.repository";

export class DatabaseService {
  private logger = createLogger("database-service");
  private mongoClient: MongoClient;
  private _submissionRepository: SubmissionRepository | null = null;
  private _checkRepository: CheckRepository | null = null;

  constructor(uri: string) {
    this.mongoClient = new MongoClient(uri);
  }

  get submissionRepository(): SubmissionRepository {
    if (!this._submissionRepository) {
      this._submissionRepository = new SubmissionRepository(this.mongoClient);
    }
    return this._submissionRepository;
  }

  get checkRepository(): CheckRepository {
    if (!this._checkRepository) {
      this._checkRepository = new CheckRepository(this.mongoClient);
    }
    return this._checkRepository;
  }

  async close(): Promise<void> {
    try {
      await this.mongoClient.close();
      this._submissionRepository = null;
      this._checkRepository = null;
    } catch (error) {
      this.logger.error({ error }, "Failed to close database connection");
    }
  }
}
