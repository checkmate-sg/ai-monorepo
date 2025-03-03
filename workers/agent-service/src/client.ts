import OpenAI from "openai";
import { getGoogleAuthToken } from "@workspace/shared-utils";
import { createLogger } from "@workspace/shared-utils";
import { LLMProvider } from "@workspace/shared-types";

const logger = createLogger("openaiClients");

/**
 * Creates an OpenAI client configured for the specified provider
 * @param provider The provider to use ('openai' or 'vertex-ai')
 * @param env The environment variables from the context
 * @returns Configured OpenAI client
 */
export async function createClient(
  provider: LLMProvider,
  env: any
): Promise<OpenAI> {
  if (provider === "openai") {
    return createOpenAIClient(env);
  } else if (provider === "vertex-ai") {
    return await createVertexAIClient(env);
  } else if (provider === "groq") {
    return createGroqClient(env);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Creates an OpenAI client configured for the OpenAI API
 * @param env The environment variables from the context
 * @returns Configured OpenAI client
 */
function createOpenAIClient(env: any): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for OpenAI client");
  }

  if (!env.PORTKEY_ENDPOINT) {
    throw new Error("PORTKEY_ENDPOINT is required for OpenAI client");
  }

  if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
    throw new Error(
      "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required for OpenAI client"
    );
  }

  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.PORTKEY_ENDPOINT,
    defaultHeaders: {
      "x-portkey-provider": "openai",
      "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
    },
  });
}

/**
 * Creates an OpenAI client configured for Vertex AI
 * @param env The environment variables from the context
 * @returns Configured OpenAI client for Vertex AI
 */
async function createVertexAIClient(env: any): Promise<OpenAI> {
  // Validate required environment variables
  if (!env.PORTKEY_ENDPOINT) {
    throw new Error("PORTKEY_ENDPOINT is required for Vertex AI client");
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for Vertex AI client"
    );
  }

  if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
    throw new Error(
      "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required for Vertex AI client"
    );
  }

  if (!env.VERTEX_PROJECT_ID) {
    throw new Error("VERTEX_PROJECT_ID is required for Vertex AI client");
  }

  if (!env.VERTEX_REGION) {
    throw new Error("VERTEX_REGION is required for Vertex AI client");
  }

  try {
    const googleAuthToken = await getGoogleAuthToken(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      "https://www.googleapis.com/auth/cloud-platform"
    );

    logger.debug("Successfully obtained Google auth token");

    return new OpenAI({
      apiKey: "123", // Placeholder API key for Vertex
      baseURL: env.PORTKEY_ENDPOINT,
      defaultHeaders: {
        "x-portkey-provider": "vertex-ai",
        "x-portkey-vertex-project-id": env.VERTEX_PROJECT_ID,
        "x-portkey-vertex-region": env.VERTEX_REGION,
        Authorization: `Bearer ${googleAuthToken}`,
        "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
        "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
      },
    });
  } catch (error: any) {
    logger.error(`Failed to create Vertex AI client: ${error.message}`);
    throw new Error(`Failed to create Vertex AI client: ${error.message}`);
  }
}

/**
 * Creates an OpenAI client configured for Groq
 * @param env The environment variables from the context
 * @returns Configured OpenAI client for Groq
 */
function createGroqClient(env: any): OpenAI {
  // Validate required environment variables
  if (!env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is required for Groq client");
  }

  if (!env.PORTKEY_ENDPOINT) {
    throw new Error("PORTKEY_ENDPOINT is required for Groq client");
  }

  if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
    throw new Error(
      "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required for Groq client"
    );
  }

  return new OpenAI({
    apiKey: env.GROQ_API_KEY,
    baseURL: env.PORTKEY_ENDPOINT,
    defaultHeaders: {
      "x-portkey-provider": "groq",
      "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
    },
  });
}
