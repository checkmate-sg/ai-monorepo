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
} from "./telegramNotifier";
import { setupTelegramBot, createWebhookHandler } from "./webhookHandler";

const app = new Hono<{ Bindings: Env }>();

const logger = createLogger("notification-service");

app.post("/webhook", async (c) => {
  const expectedToken = c.env.TELEGRAM_WEBHOOK_SECRET;

  const bot = setupTelegramBot(c.env);
  const webhookHandler = createWebhookHandler(bot, expectedToken);

  return webhookHandler(c);
});

export default class extends WorkerEntrypoint<Env> {
  private telegramNotifier = createTelegramNotifier(this.env);

  async fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env);
  }

  async sendCommunityNoteNotification(params: CommunityNoteNotificationParams) {
    try {
      await this.telegramNotifier.sendCommunityNoteNotification(params);
    } catch (error) {
      logger.error(
        `Failed to send community note notification: ${JSON.stringify(error)}`
      );
    }
  }

  async sendNewCheckNotification(params: NewCheckNotificationParams) {
    try {
      return await this.telegramNotifier.sendNewCheckNotification(params);
    } catch (error) {
      logger.error(
        `Failed to send new check notification: ${JSON.stringify(error)}`
      );
    }
  }
}
