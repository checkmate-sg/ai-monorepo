import { Bot, InlineKeyboard } from "grammy";
import { InlineKeyboardMarkup } from "grammy/types";
import { AgentRequest, CommunityNote } from "@workspace/shared-types";

export interface CommunityNoteNotificationParams {
  id: string;
  communityNote: CommunityNote | null;
  isAccessBlocked: boolean;
  isVideo: boolean;
  isControversial: boolean;
  isError: boolean;
  replyId: number | null;
}

export interface NewCheckNotificationParams {
  id: string;
  agentRequest: AgentRequest;
}

export class TelegramNotificationHandler {
  private bot: Bot;
  private env: Env;

  constructor(botToken: string, env: Env) {
    this.bot = new Bot(botToken);
    this.env = env;
  }

  async sendCommunityNoteNotification(params: CommunityNoteNotificationParams) {
    const {
      id,
      replyId,
      communityNote,
      isAccessBlocked,
      isVideo,
      isControversial,
      isError,
    } = params;
    try {
      if (!this.env.ADMIN_CHAT_ID || !this.env.MESSAGE_FEED_TOPIC_ID) {
        throw new Error("ADMIN_CHAT_ID or MESSAGE_FEED_TOPIC_ID is not set");
      }
      let notificationText = "";
      const langfuseBaseURL = this.env.LANGFUSE_HOST;
      const langfuseProjectId = this.env.LANGFUSE_PROJECT_ID;
      let replyMarkup: InlineKeyboardMarkup = {
        inline_keyboard: [
          [
            {
              text: "View on LangFuse",
              url: `${langfuseBaseURL}/project/${langfuseProjectId}/traces/${id}`,
            },
          ],
        ],
      };
      const approveButton = {
        text: "Approve for publishing",
        callback_data: `publish_${id}`,
      };
      if (isAccessBlocked) {
        notificationText =
          "Community note generated but not used as access was blocked";
      } else if (isVideo) {
        notificationText =
          "Community note generated but not used as it was a video";
      } else if (communityNote === null) {
        if (isError) {
          notificationText =
            "An error occurred while generating the community note";
        } else {
          notificationText = "An unknown error occurred";
        }
      } else {
        let links = communityNote.links ? communityNote.links.join("\n") : "";
        if (isControversial) {
          notificationText = `Controversial Community Note Generated:\n\nID: ${id}\nCommunity Note:\n\n${communityNote.en}\n\nLinks:\n${links}`;
        } else {
          notificationText = `Community Note Generated:\n\nID: ${id}\nCommunity Note:\n\n${communityNote.en}\n\nLinks:\n${links}`;
          replyMarkup.inline_keyboard.push([approveButton]);
        }
      }
      await this.bot.api.sendMessage(this.env.ADMIN_CHAT_ID, notificationText, {
        reply_to_message_id:
          replyId ?? parseInt(this.env.MESSAGE_FEED_TOPIC_ID),
        reply_markup: replyMarkup,
      });
    } catch (error) {
      throw new Error("Failed to send community note notification");
    }
  }

  async sendNewCheckNotification(params: NewCheckNotificationParams) {
    const { id, agentRequest } = params;
    let notificationId: number | null;
    try {
      if (!this.env.ADMIN_CHAT_ID || !this.env.MESSAGE_FEED_TOPIC_ID) {
        throw new Error("ADMIN_CHAT_ID or MESSAGE_FEED_TOPIC_ID is not set");
      }
      if (agentRequest.text) {
        const message = await this.bot.api.sendMessage(
          this.env.ADMIN_CHAT_ID,
          agentRequest.text,
          {
            reply_to_message_id: parseInt(this.env.MESSAGE_FEED_TOPIC_ID),
          }
        );
        notificationId = message.message_id;
      } else if (agentRequest.imageUrl) {
        const message = await this.bot.api.sendPhoto(
          this.env.ADMIN_CHAT_ID,
          agentRequest.imageUrl,
          {
            caption: agentRequest.caption,
            reply_to_message_id: parseInt(this.env.MESSAGE_FEED_TOPIC_ID),
          }
        );
        notificationId = message.message_id;
      } else {
        throw new Error("No text or imageUrl provided");
      }
      return notificationId;
    } catch (error) {
      throw new Error("Failed to send new check notification");
    }
  }
}

export function createTelegramNotifier(env: Env): TelegramNotificationHandler {
  return new TelegramNotificationHandler(env.TELEGRAM_BOT_TOKEN, env);
}
