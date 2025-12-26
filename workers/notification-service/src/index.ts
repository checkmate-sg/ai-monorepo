/**
 * Notification Service Worker
 *
 * This worker is responsible for sending notifications
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";
import { Hono } from "hono";
import {
  createTelegramNotifier,
  CommunityNoteNotificationParams,
  NewCheckNotificationParams,
  NewlyAssessedNotificationParams,
  CategoryChangeNotificationParams,
  CommunityNoteDownvoteNotificationParams,
} from "./telegramNotifier";
import { setupTelegramBot, createWebhookHandler } from "./webhookHandler";

const app = new Hono<{ Bindings: Env }>();

app.post("/webhook", async (c) => {
  const expectedToken = c.env.TELEGRAM_WEBHOOK_SECRET;

  const bot = setupTelegramBot(c.env);
  const webhookHandler = createWebhookHandler(bot, expectedToken);

  return webhookHandler(c);
});

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("notification-service");
  private telegramNotifier = createTelegramNotifier(this.env);

  async fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env);
  }

  async sendCommunityNoteNotification(params: CommunityNoteNotificationParams) {
    try {
      await this.telegramNotifier.sendCommunityNoteNotification(params);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error("Failed to send community note notification", {
        error: errorMessage,
        stack: errorStack,
        params: JSON.stringify(params),
      });

      // Re-throw to ensure RPC failure is properly reported
      throw new Error(`Community note notification failed: ${errorMessage}`);
    }
  }

  async sendNewCheckNotification(params: NewCheckNotificationParams) {
    try {
      return await this.telegramNotifier.sendNewCheckNotification(params);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error("Failed to send new check notification", {
        error: errorMessage,
        stack: errorStack,
        params: JSON.stringify(params),
      });

      // Re-throw to ensure RPC failure is properly reported
      throw new Error(`New check notification failed: ${errorMessage}`);
    }
  }

  async sendNewlyAssessedNotification(params: NewlyAssessedNotificationParams) {
    try {
      return await this.telegramNotifier.sendNewlyAssessedNotification(params);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error("Failed to send newly assessed notification", {
        error: errorMessage,
        stack: errorStack,
        params: JSON.stringify(params),
      });

      throw new Error(`Newly assessed notification failed: ${errorMessage}`);
    }
  }

  async sendCategoryChangeNotification(
    params: CategoryChangeNotificationParams
  ) {
    try {
      return await this.telegramNotifier.sendCategoryChangeNotification(params);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error("Failed to send category change notification", {
        error: errorMessage,
        stack: errorStack,
        params: JSON.stringify(params),
      });

      throw new Error(`Category change notification failed: ${errorMessage}`);
    }
  }

  async sendCommunityNoteDownvoteNotification(
    params: CommunityNoteDownvoteNotificationParams
  ) {
    try {
      return await this.telegramNotifier.sendCommunityNoteDownvoteNotification(
        params
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error("Failed to send community note downvote notification", {
        error: errorMessage,
        stack: errorStack,
        params: JSON.stringify(params),
      });

      throw new Error(
        `Community note downvote notification failed: ${errorMessage}`
      );
    }
  }
}
