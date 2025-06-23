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
const BLACKLIST_VERSION_KEY = "blacklist:version";
const BLACKLIST_BACKUP_KEY = "blacklist:backup";
const PHONE_PREFIX = "phone:";
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

interface BlacklistBackup {
  version: string;
  timestamp: number;
  count: number;
  phoneNumbers: string[];
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

      // Step 1: Store backup of the complete list
      const backup: BlacklistBackup = {
        version,
        timestamp: Date.now(),
        count: uniquePhones.length,
        phoneNumbers: uniquePhones,
      };

      await this.env.SCAMSHIELD_BLACKLIST_KV.put(
        BLACKLIST_BACKUP_KEY,
        JSON.stringify(backup)
      );

      // Step 2: Update the version
      await this.env.SCAMSHIELD_BLACKLIST_KV.put(
        BLACKLIST_VERSION_KEY,
        version
      );

      // Step 3: Batch update individual phone entries
      // KV has a limit of 1000 operations per batch
      const BATCH_SIZE = 1000;

      for (let i = 0; i < uniquePhones.length; i += BATCH_SIZE) {
        const batch = uniquePhones.slice(i, i + BATCH_SIZE);

        // Use Promise.all for parallel writes within each batch
        await Promise.all(
          batch.map((phone) =>
            this.env.SCAMSHIELD_BLACKLIST_KV.put(
              `${PHONE_PREFIX}${phone}`,
              version,
              { expirationTtl: TTL_SECONDS }
            )
          )
        );

        this.logger.info(
          {
            processed: Math.min(i + BATCH_SIZE, uniquePhones.length),
            total: uniquePhones.length,
          },
          "Batch processed"
        );
      }

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
      // Get current version
      const currentVersion = await this.env.SCAMSHIELD_BLACKLIST_KV.get(
        BLACKLIST_VERSION_KEY
      );

      if (!currentVersion) {
        // No blacklist has been set yet
        return {
          isBlacklisted: false,
          error: "No blacklist configured",
        };
      }

      // Check if phone exists and matches current version
      const phoneVersion = await this.env.SCAMSHIELD_BLACKLIST_KV.get(
        `${PHONE_PREFIX}${phone.trim()}`
      );

      return {
        isBlacklisted: phoneVersion === currentVersion,
        version: currentVersion,
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
