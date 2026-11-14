import { Logger } from "pino";

export interface CheckContext {
  env: Env;
  logger: Logger;
  /** MongoDB check ID; also seeds the Langfuse trace ID */
  checkId: string | null;
  ctx: ExecutionContext;
}
