import { fromHono } from "chanfana";
import { Hono } from "hono";
import { Embed } from "./endpoints/embed";
import { AgentCheck } from "./endpoints/agentCheck";
import { CommunityNote } from "./endpoints/communityNote";
import { TrivialFilter } from "./endpoints/trivialFilter";
import { ConsumerPost } from "./endpoints/consumerPost";
import { ConsumerList } from "./endpoints/consumerList";
import { UpsertBlacklist } from "./endpoints/upsertBlacklist";
import { ConsumerGet } from "./endpoints/consumerGet";
import { consumerAuth } from "./middleware/consumerAuth";
import { adminAuth } from "./middleware/adminAuth";
import { ConsumerDelete } from "./endpoints/consumerDelete";
import { ConsumerUpdateAPIs } from "./endpoints/consumerUpdateAPIs";
export { Consumer } from "./durable-objects/consumer";

// Start a Hono app
const app = new Hono();

// Setup OpenAPI registry
const openapi = fromHono(app, {
  docs_url: "/docs",
});

// Apply middleware to protected routes
app.use("/getEmbedding", consumerAuth);
app.use("/getAgentResult", consumerAuth);
app.use("/getCommunityNote", consumerAuth);
app.use("/getNeedsChecking", consumerAuth);
app.use("/upsertBlacklist", consumerAuth);

// Apply adminAuth middleware to admin routes
app.use("/consumers", adminAuth);

// Register OpenAPI endpoints

// Get the embedding of a text
openapi.post("/getEmbedding", Embed);

// Performs the full agent check
openapi.post("/getAgentResult", AgentCheck);

// Same as getAgentResult but does not return the long-form report
openapi.post("/getCommunityNote", CommunityNote);

// Check if a message needs checking
openapi.post("/getNeedsChecking", TrivialFilter);

// Let the consumer get their own details
openapi.get("/consumer/details", ConsumerGet);

// Upsert the phone number blacklist
openapi.post("/upsertBlacklist", UpsertBlacklist);

// Consumer endpoints - these need admin auth middleware
openapi.post("/consumers", ConsumerPost);
openapi.get("/consumers", ConsumerList);
// Support deletion by name (path param) or by API key (header) or both
openapi.delete("/consumers/:consumerName?", ConsumerDelete);
// Update allowed APIs for a consumer - supports update by name, API key, or both
openapi.put("/consumers/:consumerName/allowedAPIs", ConsumerUpdateAPIs);
openapi.put("/consumers/allowedAPIs", ConsumerUpdateAPIs);

// Export the Hono app
export default app;
