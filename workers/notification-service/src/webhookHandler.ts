import { Bot, webhookCallback } from "grammy";
import { createLogger } from "@workspace/shared-utils";
import { traceUrlForCheck } from "@workspace/shared-langfuse/trace-id";

const logger = createLogger("webhook-handler");

export function setupTelegramBot(env: Env) {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  bot.on("callback_query:data", async (ctx) => {
    try {
      const callbackData = ctx.callbackQuery?.data;

      if (!callbackData) {
        logger.error("No callback data found");
        await ctx.answerCallbackQuery({ text: "No callback data found" });
        return;
      }

      const [action, messageId] = callbackData.split("_");
      if (!messageId) {
        logger.error("No message ID found in callback data");
        await ctx.answerCallbackQuery({
          text: "No message ID found in callback data",
        });
        return;
      }

      let button: { text: string; callback_data: string } | undefined =
        undefined;

      switch (action) {
        case "publish":
          await env.DATABASE_SERVICE.updateCheck(messageId, {
            isApprovedForPublishing: true,
            approvedBy: ctx.from?.id,
          });

          logger.info({ messageId }, "Approval request received for message");

          await ctx.answerCallbackQuery({ text: "Published" });
          button = {
            text: "Unpublish",
            callback_data: `unpublish_${messageId}`,
          };
          break;

        case "unpublish":
          await env.DATABASE_SERVICE.updateCheck(messageId, {
            isApprovedForPublishing: false,
            approvedBy: null,
          });

          await ctx.answerCallbackQuery({ text: "Unpublished" });
          button = {
            text: "Approve for publishing",
            callback_data: `publish_${messageId}`,
          };
          break;

        default:
          await ctx.answerCallbackQuery({ text: "Unknown action" });
          return;
      }

      // Update the message to show the new button state
      // Keep the message's existing Langfuse link: checks traced before the
      // Langfuse v4 migration use the raw check ID as their trace ID
      const existingLink = ctx.callbackQuery.message?.reply_markup?.inline_keyboard
        .flat()
        .find((b): b is { text: string; url: string } => "url" in b);
      const updatedKeyboard: Array<
        { text: string } & ({ url: string } | { callback_data: string })
      > = [
        existingLink ?? {
          text: "View on LangFuse",
          url: await traceUrlForCheck(
            env.LANGFUSE_HOST,
            env.LANGFUSE_PROJECT_ID,
            messageId
          ),
        },
      ];

      if (button) {
        updatedKeyboard.push(button);
      }

      await ctx.editMessageReplyMarkup({
        reply_markup: {
          inline_keyboard: [updatedKeyboard],
        },
      });
    } catch (error) {
      logger.error({ error }, "Error handling callback query:");
      await ctx.answerCallbackQuery({
        text: "An error occurred while processing your request.",
      });
    }
  });

  return bot;
}

export function createWebhookHandler(bot: Bot, secretToken?: string) {
  return webhookCallback(bot, "hono", {
    secretToken,
  });
}
