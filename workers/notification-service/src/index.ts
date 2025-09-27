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
    await this.telegramNotifier.sendCommunityNoteNotification(params);
  }

  async sendNewCheckNotification(params: NewCheckNotificationParams) {
    return await this.telegramNotifier.sendNewCheckNotification(params);
  }
}
