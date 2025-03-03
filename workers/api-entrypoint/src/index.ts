import { fromHono } from "chanfana";
import { Hono } from "hono";
import { Embed } from "./endpoints/embed";
import { AgentCheck } from "./endpoints/agentCheck";
import { CommunityNote } from "./endpoints/communityNote";
// Start a Hono app
const app = new Hono();

// Setup OpenAPI registry
const openapi = fromHono(app, {
  docs_url: "/",
});

// Register OpenAPI endpoints

// Get the embedding of a text
openapi.post("/getEmbedding", Embed);

// Performs the full agent check
openapi.post("/getAgentResult", AgentCheck);

// Same as getAgentResult but does not return the long-form report
openapi.post("/getCommunityNote", CommunityNote);

// Export the Hono app
export default app;
