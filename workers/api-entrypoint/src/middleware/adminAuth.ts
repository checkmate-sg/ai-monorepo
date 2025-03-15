import { Context, Next } from "hono";
import { createLogger } from "@workspace/shared-utils";

const logger = createLogger("Admin Auth Middleware");

export async function adminAuth(c: Context<{ Bindings: Env }>, next: Next) {
  try {
    console.log(Object.keys(c.req.header()));
    if (c.env.ENVIRONMENT === "development") {
      await next();
      return;
    }
    // Get the Cloudflare Access service token headers
    const clientId = c.req.header("CF-Access-Client-Id");
    const clientSecret = c.req.header("CF-Access-Client-Secret");

    if (!clientId || !clientSecret) {
      logger.warn("Missing Cloudflare Access service token headers");
      return c.json(
        { error: "Unauthorized: Missing Cloudflare Access service token" },
        { status: 401 }
      );
    }

    // In a production environment, you would validate these credentials against expected values
    // For example, comparing against environment variables or a secure storage

    // For now, we're just checking for the presence of the headers
    // as Cloudflare Access handles the authentication before the request reaches the worker

    logger.info(`Admin access by service client: ${clientId}`);

    // Continue to the next middleware or route handler
    await next();
  } catch (error) {
    logger.error("Error in admin auth middleware", error);
    return c.json(
      { error: "Internal server error during authentication" },
      { status: 500 }
    );
  }
}
