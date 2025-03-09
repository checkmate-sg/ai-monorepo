import { DurableObject } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";

export interface AddConsumerRequest {
  name: string;
  allowedAPIs: string[];
  apiKey: string;
  millisecondsPerRequest?: number; // Defines the rate at which tokens are added to the bucket (controls the refill speed).
  capacity?: number; //Defines the maximum number of tokens that can be stored in the bucket at any time. This controls how many requests can be processed in bursts.
  millisecondsForUpdates?: number; // Controls how often the refill function (alarm()) runs to restore tokens.
}

interface ConsumerDetailsResponse {
  name: string;
  apiKey: string;
  isActive: boolean;
  apiCounts: {
    [apiName: string]: {
      totalCalls: number;
      totalCallsThisMonth: number;
    };
  };
}

function getCurrentMonthYear() {
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  return `${currentMonth}-${currentYear}`;
}

export class Consumer extends DurableObject<Env> {
  private tokens: number = 0;
  private logger = createLogger("Consumer API Handler");
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initalizeTokens();
  }

  // Static method to generate a secure API key
  static generateAPIKey(length = 32): string {
    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);

    let result = "";
    for (let i = 0; i < length; i++) {
      result += characters.charAt(randomValues[i] % characters.length);
    }
    return result;
  }

  async initalizeTokens() {
    this.tokens = (await this.ctx.storage.get("tokens")) || 0;
  }

  async createConsumer(request: AddConsumerRequest) {
    try {
      if (!request.name) {
        throw new Error("Name is required");
      }
      if (!request.allowedAPIs) {
        throw new Error("Allowed APIs are required");
      }
      //check if consumer already exists
      const consumer = await this.env.CONSUMER_KV.get(
        `consumer:${request.name}`
      );
      if (consumer) {
        throw new Error("Consumer already exists");
      }

      // Store consumer name in KV for reference
      await this.env.CONSUMER_KV.put(
        `consumer:${request.name}`,
        request.apiKey
      );
      await this.ctx.storage.put("isActive", true);
      await this.ctx.storage.put("name", request.name);
      await this.ctx.storage.put("apiKey", request.apiKey);
      await this.ctx.storage.put("allowedAPIs", request.allowedAPIs);
      await this.ctx.storage.put(
        "millisecondsPerRequest",
        request.millisecondsPerRequest || 1000
      );
      await this.ctx.storage.put("capacity", request.capacity || 100);
      await this.ctx.storage.put(
        "millisecondsForUpdates",
        request.millisecondsForUpdates || 10000
      );

      // Initialize tokens to full capacity
      const capacity = request.capacity || 100;
      this.tokens = capacity;
      await this.ctx.storage.put("tokens", this.tokens);

      // Set initial alarm
      await this.checkAndSetAlarm();
      await this.ctx.storage.put("totalCalls", 0);
      //create a counter for the specific month
      const currentMonthYear = getCurrentMonthYear();
      await this.ctx.storage.put(currentMonthYear, 0);

      // Return the API key, which is the same as the Durable Object ID
      return {
        success: true,
      };
    } catch (error) {
      let errorMessage = "An unknown error occurred";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      this.logger.error(errorMessage);
      return {
        success: false,
        error: {
          message: errorMessage,
        },
      };
    }
  }

  async checkConsumerExists(): Promise<boolean> {
    const name = await this.ctx.storage.get("name");
    const isActive = await this.ctx.storage.get("isActive");
    if (!name || !isActive) {
      return false;
    }
    return true;
  }

  async checkAllowedAPI(api: string): Promise<boolean> {
    const allowedAPIs = (await this.ctx.storage.get("allowedAPIs")) as string[];
    return allowedAPIs.includes(api);
  }

  async incrementCounts(api: string) {
    const currentMonthYear = getCurrentMonthYear();
    let totalCalls: number =
      (await this.ctx.storage.get(`totalCalls-${api}`)) || 0;
    let totalCallsThisMonth: number =
      (await this.ctx.storage.get(`totalCalls-${currentMonthYear}-${api}`)) ||
      0;
    totalCalls += 1;
    totalCallsThisMonth += 1;
    await this.ctx.storage.put(`totalCalls-${api}`, totalCalls);
    await this.ctx.storage.put(
      `totalCalls-${currentMonthYear}-${api}`,
      totalCallsThisMonth
    );
  }

  async getDetails(): Promise<ConsumerDetailsResponse> {
    const currentMonthYear = getCurrentMonthYear();
    const apiCounts: {
      [apiName: string]: { totalCalls: number; totalCallsThisMonth: number };
    } = {};

    // Get the list of allowed APIs
    const allowedAPIs = (await this.ctx.storage.get("allowedAPIs")) as string[];

    // Collect stats for each API
    for (const api of allowedAPIs) {
      const totalCalls: number =
        (await this.ctx.storage.get(`totalCalls-${api}`)) || 0;
      const totalCallsThisMonth: number =
        (await this.ctx.storage.get(`totalCalls-${currentMonthYear}-${api}`)) ||
        0;

      apiCounts[api] = {
        totalCalls,
        totalCallsThisMonth,
      };
    }
    return {
      name: (await this.ctx.storage.get("name")) as string,
      apiKey: (await this.ctx.storage.get("apiKey")) as string,
      isActive: (await this.ctx.storage.get("isActive")) as boolean,
      apiCounts,
    };
  }

  async getName(): Promise<string | null> {
    return (await this.ctx.storage.get("name")) as string | null;
  }

  // Rate limiting functionality
  async getMillisecondsToNextRequest() {
    await this.checkAndSetAlarm();

    // Load current tokens from storage to ensure consistency
    const storedTokens = await this.ctx.storage.get("tokens");
    this.tokens = typeof storedTokens === "number" ? storedTokens : 0;

    const millisecondsPerRequest = (await this.ctx.storage.get(
      "millisecondsPerRequest"
    )) as number;
    let milliseconds_to_next_request = millisecondsPerRequest;

    if (this.tokens > 0) {
      this.tokens -= 1;
      await this.ctx.storage.put("tokens", this.tokens);
      milliseconds_to_next_request = 0;
    }

    return milliseconds_to_next_request;
  }

  async checkAndSetAlarm() {
    let currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm == null) {
      const millisecondsForUpdates = (await this.ctx.storage.get(
        "millisecondsForUpdates"
      )) as number;

      await this.ctx.storage.setAlarm(Date.now() + millisecondsForUpdates);
    }
  }

  async alarm() {
    // Load current tokens and capacity from storage
    const storedTokens = await this.ctx.storage.get("tokens");
    this.tokens = typeof storedTokens === "number" ? storedTokens : 0;

    const capacity = (await this.ctx.storage.get("capacity")) as number;
    const millisecondsForUpdates = (await this.ctx.storage.get(
      "millisecondsForUpdates"
    )) as number;
    const millisecondsPerRequest = (await this.ctx.storage.get(
      "millisecondsPerRequest"
    )) as number;

    if (this.tokens < capacity) {
      // Calculate how many tokens to add based on the time elapsed
      const tokensToAdd = Math.floor(
        millisecondsForUpdates / millisecondsPerRequest
      );

      this.tokens = Math.min(capacity, this.tokens + tokensToAdd);
      await this.ctx.storage.put("tokens", this.tokens);

      // Set the next alarm
      await this.checkAndSetAlarm();
    }
  }
}
