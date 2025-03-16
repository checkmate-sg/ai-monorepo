import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { createLogger } from "@workspace/shared-utils";
import { ErrorResponseSchema, SuccessResponseSchema } from "../schemas";
import {
  AgentCheckResultSchema,
  handleAgentRequest,
  agentRequestSchema,
} from "./agentCheck";

const logger = createLogger("communityNote");

// Define the community note result schema by omitting the report field from AgentCheckResultSchema
const CommunityNoteResultSchema = AgentCheckResultSchema.omit({ report: true });

export class CommunityNote extends OpenAPIRoute {
  schema = {
    tags: ["Agent"],
    summary: "Get only the community note",
    security: [{ ApiKeyAuth: [] }],
    request: agentRequestSchema,
    responses: {
      "200": {
        description: "Returns the community note result",
        content: {
          "application/json": {
            schema: SuccessResponseSchema(CommunityNoteResultSchema),
          },
        },
      },
      "500": {
        description: "Error response",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  };

  async handle(c: Context): Promise<Response> {
    const data = await this.getValidatedData<typeof this.schema>();
    // Use the shared handler but process the response to remove the report field
    return handleAgentRequest(c, data, logger, true);
  }
}
