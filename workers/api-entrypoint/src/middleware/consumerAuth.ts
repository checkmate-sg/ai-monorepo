import { Context, Next } from "hono";
import { createLogger } from "@workspace/shared-utils";

const logger = createLogger("Consumer Auth Middleware");

export async function consumerAuth(c: Context<{ Bindings: Env }>, next: Next) {
  try {
    if (c.env.ENVIRONMENT === "development") {
      await next();
      return;
    }
    // Get the API key from the X-API-Key header (case-insensitive)
    // Try the standard format first, then fallback to checking headers case-insensitively
    let apiKey = c.req.header("X-API-Key");

    if (!apiKey) {
      // If not found with exact case, try to find it case-insensitively
      const headers = Object.fromEntries(
        Object.entries(c.req.raw.headers).map(([k, v]) => [k.toLowerCase(), v])
      );
      apiKey = headers["x-api-key"];
    }

    if (!apiKey) {
      return c.json({ error: "Missing X-API-Key header" }, { status: 401 });
    }

    // Get the API name from the path
    const path = c.req.path;
    const apiName = path.split("/")[1]; // e.g., /getEmbedding -> getEmbedding

    // Get the consumer Durable Object directly using the API key as the name
    const consumerId = c.env.CONSUMER.idFromName(apiKey);
    const stub = c.env.CONSUMER.get(consumerId);

    // Check if the consumer is initialized
    const isInitialized = await stub.checkConsumerExists();
    if (!isInitialized) {
      return c.json({ error: "Consumer not found" }, { status: 404 });
    }

    // Check if the consumer has access to this API
    const hasAccess = await stub.checkAllowedAPI(apiName);
    if (!hasAccess) {
      return c.json(
        { error: `Access denied to API: ${apiName}` },
        { status: 403 }
      );
    }

    // Check rate limits
    const millisecondsToWait = await stub.getMillisecondsToNextRequest();
    if (millisecondsToWait > 0) {
      return c.json(
        {
          error: "Rate limit exceeded",
          retryAfter: millisecondsToWait,
        },
        {
          status: 429,
          headers: {
            "Retry-After": (millisecondsToWait / 1000).toString(),
          },
        }
      );
    }

    // Continue to the next middleware or route handler
    await next();

    // Only increment the API call counts if the response was successful (not a 5xx error)
    // We can access the response status after next() has been called
    const status = c.res.status;
    if (status < 500) {
      // Increment counts for all responses except server errors (5xx)
      await stub.incrementCounts(apiName);
    } else {
      logger.info(
        `Not incrementing count for ${apiName} due to status ${status}`
      );
    }
  } catch (error) {
    logger.error("Error in consumer auth middleware", error);
    return c.json(
      { error: "Internal server error during authentication" },
      { status: 500 }
    );
  }
}
