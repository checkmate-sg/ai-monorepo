/**
 * Blacklist Service Worker
 *
 * This worker manages phone number blacklists with two main operations:
 * 1. Update the entire blacklist (replaces the previous list)
 * 2. Check if a phone number is blacklisted
 *
 * Uses Cloudflare KV for storage with versioning to handle updates atomically.
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";

// Constants
const BLACKLIST_KEY = "blacklist:data";
const TTL_SECONDS = 7 * 24 * 60 * 60; // 1 week

// Types
interface UpdateBlacklistRequest {
  phoneNumbers: string[];
}

interface UpdateBlacklistResponse {
  success: boolean;
  count?: number;
  version?: string;
  error?: string;
}

interface CheckBlacklistResponse {
  isBlacklisted: boolean;
  version?: string;
  error?: string;
}

interface BlacklistData {
  version: string;
  timestamp: number;
  count: number;
  phoneNumbers: Set<string>;
}

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("blacklist-service");

  async fetch(request: Request): Promise<Response> {
    try {
      // Health check endpoint only - this service is accessed via service bindings
      return new Response(
        JSON.stringify({
          status: "healthy",
          service: "blacklist-service",
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      this.logger.error({ error }, "Error handling health check request");
      return new Response(
        JSON.stringify({ success: false, error: "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  /**
   * Updates the entire blacklist with a new set of phone numbers
   * Uses versioning to ensure atomic updates
   */
  async updateBlacklist(
    phoneNumbers: string[]
  ): Promise<UpdateBlacklistResponse> {
    try {
      const startTime = Date.now();
      const version = Date.now().toString();

      // Deduplicate and clean phone numbers
      const uniquePhones = [
        ...new Set(phoneNumbers.map((phone) => phone.trim())),
      ];

      this.logger.info(
        {
          count: uniquePhones.length,
          version,
        },
        "Starting blacklist update"
      );

      // Store the entire blacklist as a single JSON object
      const blacklistData = {
        version,
        timestamp: Date.now(),
        count: uniquePhones.length,
        phoneNumbers: uniquePhones,
      };

      await this.env.SCAMSHIELD_BLACKLIST_KV.put(
        BLACKLIST_KEY,
        JSON.stringify(blacklistData),
        { expirationTtl: TTL_SECONDS }
      );

      const duration = Date.now() - startTime;
      this.logger.info(
        {
          count: uniquePhones.length,
          version,
          duration,
        },
        "Blacklist update completed"
      );

      return {
        success: true,
        count: uniquePhones.length,
        version,
      };
    } catch (error) {
      this.logger.error({ error }, "Failed to update blacklist");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Checks if a phone number is in the current blacklist
   * Uses versioning to ensure consistency
   */
  async lookupBlacklist(phone: string): Promise<CheckBlacklistResponse> {
    try {
      // Get the blacklist data
      const blacklistJson = await this.env.SCAMSHIELD_BLACKLIST_KV.get(
        BLACKLIST_KEY
      );

      if (!blacklistJson) {
        // No blacklist has been set yet
        return {
          isBlacklisted: false,
          error: "No blacklist configured",
        };
      }

      const blacklistData = JSON.parse(blacklistJson);
      const phoneNumbers = new Set(blacklistData.phoneNumbers);

      return {
        isBlacklisted: phoneNumbers.has(phone.trim()),
        version: blacklistData.version,
      };
    } catch (error) {
      this.logger.error({ error, phone }, "Failed to check blacklist");
      return {
        isBlacklisted: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
