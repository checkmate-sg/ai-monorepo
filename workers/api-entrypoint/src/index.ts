import { fromHono } from "chanfana";
import { Hono } from "hono";
import { Embed } from "./endpoints/embed";

// Start a Hono app
const app = new Hono();

// Setup OpenAPI registry
const openapi = fromHono(app, {
  docs_url: "/",
});

// Register OpenAPI endpoints
openapi.post("/getEmbedding", Embed);

// Export the Hono app
export default app;
