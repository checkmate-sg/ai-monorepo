import { Logger } from "pino";
import { Langfuse } from "langfuse";

export interface CheckContext {
  env: Env;
  logger: Logger;
  trace: ReturnType<Langfuse["trace"]> | null;
  ctx: ExecutionContext;
}
