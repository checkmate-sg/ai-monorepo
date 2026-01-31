import { createLogger } from "@workspace/shared-utils";
import {
  CheckUpdate,
  ServiceResponse,
  ErrorResponse,
} from "@workspace/shared-types";
import { WorkerEntrypoint } from "cloudflare:workers";

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("checks-service");

  /**
   * This is the standard fetch handler for a Cloudflare Worker
   *
   * @param request - The request submitted to the Worker from the client
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   * @param ctx - The execution context of the Worker
   * @returns The response to be sent back to the client
   */
  async fetch(request: Request): Promise<Response> {
    // We will create a `DurableObjectId` using the pathname from the Worker request
    // This id refers to a unique instance of our 'MyDurableObject' class above
    if (this.env.ENVIRONMENT === "development") {
      let id: DurableObjectId = this.env.CHECKER_AGENT.idFromName(
        crypto.randomUUID()
      );

      // This stub creates a communication channel with the Durable Object instance
      // The Durable Object constructor will be invoked upon the first call for a given id
      let stub = this.env.CHECKER_AGENT.get(id);

      // We call the `sayHello()` RPC method on the stub to invoke the method on the remote
      // Durable Object instance
      let result = await stub.check(
        {
          id: "123",
          imageUrl:
            "https://storage.googleapis.com/checkmate-screenshots-uat/edb4972344acf6e7da688425e4490ab9.png",
          caption: "Is this true?",
        },
        "123"
      );

      return new Response(JSON.stringify(result));
    } else {
      return new Response("Hello from agent-service");
    }
  }

  async updateHumanResponse(
    checkId: string,
    humanNote: {
      en: string | null;
      cn: string | null;
      links: string[] | null;
      updatedBy: string;
    }
  ): Promise<ServiceResponse | ErrorResponse> {
    try {
      this.logger.info({ checkId, humanNote }, "Updating human response");

      const humanResponse = {
        en: humanNote.en,
        cn: humanNote.cn,
        links: humanNote.links,
        timestamp: new Date(),
        updatedBy: humanNote.updatedBy,
      };

      const result = await this.env.DATABASE_SERVICE.updateCheck(checkId, {
        humanResponse,
      });

      if (!result.success) {
        throw new Error("Failed to update human response");
      }

      this.logger.info({ checkId }, "Human response updated successfully");

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.logger.error(
        { checkId, error, errorMessage },
        "Error updating human response"
      );

      return {
        success: false,
        error: {
          message: errorMessage,
        },
      };
    }
  }

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    this.logger.info({ batch }, "Consuming from queue");
    const messages = batch.messages;
    for (const message of messages) {
      const update = message.body as CheckUpdate;

      const result = await this.env.DATABASE_SERVICE.updateCheckWithChanges(
        update.id,
        {
          isHumanAssessed: update.isHumanAssessed ?? false,
          "shortformResponse.downvoted":
            update.isCommunityNoteDownvoted ?? false,
          crowdsourcedCategory: update.crowdsourcedCategory ?? "unsure",
        }
      );

      if (result.success && result.changes) {
        const hasNotifiableChanges =
          result.changes.becameHumanAssessed ||
          result.changes.becameDownvoted ||
          result.changes.crowdsourcedCategoryChanged;

        // Fetch check to get notification IDs if we need to send notifications
        let notificationId: number | null = null;
        let communityNoteNotificationId: number | null = null;

        if (hasNotifiableChanges) {
          const checkResult = await this.env.DATABASE_SERVICE.findCheckById(
            update.id
          );
          if (checkResult.success && checkResult.data) {
            notificationId = checkResult.data.notificationId;
            communityNoteNotificationId =
              checkResult.data.communityNoteNotificationId;
          }
        }

        if (result.changes.becameHumanAssessed) {
          await this.env.CORE_CHECK_EVENTS_QUEUE.send({
            checkId: update.id,
            type: "assessed",
          });

          // Send newly assessed notification
          if (notificationId) {
            try {
              await this.env.NOTIFICATION_SERVICE.sendNewlyAssessedNotification(
                {
                  id: update.id,
                  crowdsourcedCategory: update.crowdsourcedCategory ?? "unsure",
                  replyToMessageId: notificationId,
                }
              );
            } catch (error) {
              this.logger.error(
                { error, checkId: update.id },
                "Failed to send newly assessed notification"
              );
            }
          }
        }

        if (result.changes.becameDownvoted) {
          await this.env.CORE_CHECK_EVENTS_QUEUE.send({
            checkId: update.id,
            type: "downvoted",
          });

          // Send community note downvote notification
          if (communityNoteNotificationId) {
            try {
              await this.env.NOTIFICATION_SERVICE.sendCommunityNoteDownvoteNotification(
                {
                  id: update.id,
                  replyToMessageId: communityNoteNotificationId,
                }
              );
            } catch (error) {
              this.logger.error(
                { error, checkId: update.id },
                "Failed to send community note downvote notification"
              );
            }
          }
        }

        // Send category change notification (only if not newly assessed, to avoid duplicate info)
        if (
          result.changes.crowdsourcedCategoryChanged &&
          !result.changes.becameHumanAssessed &&
          update.isHumanAssessed === true
        ) {
          if (notificationId) {
            try {
              await this.env.NOTIFICATION_SERVICE.sendCategoryChangeNotification(
                {
                  id: update.id,
                  previousCategory:
                    result.changes.previousCrowdsourcedCategory ?? null,
                  currentCategory:
                    result.changes.currentCrowdsourcedCategory ?? null,
                  replyToMessageId: notificationId,
                }
              );
            } catch (error) {
              this.logger.error(
                { error, checkId: update.id },
                "Failed to send category change notification"
              );
            }
          }
        }
      }
    }
  }
}
