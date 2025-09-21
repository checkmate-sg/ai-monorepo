import { WorkerEntrypoint } from "cloudflare:workers";
import { createLogger } from "@workspace/shared-utils";
import { WorkerMailer } from "worker-mailer";

/**
 * Email Service Worker
 *
 * This worker provides email sending functionality that can be accessed
 * via HTTP requests or service bindings from other workers.
 */

interface EmailRequest {
  data: {
    url: string;
    source: string;
    phone_number: string;
    report?: AbuseReport;
  };
}

interface AbuseReport {
  schema_version: string;
  report_type: string;
  reported_from: string;
  category: string;
  source: {
    service: string;
    phone_number: string;
  };
  event_time: string;
  report_time: string;
  additional_data?: {
    service?: string;
    platform?: string;
    app_version?: string;
    [key: string]: any;
  };
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: {
    message: string;
    details: any;
  };
}

export default class extends WorkerEntrypoint<Env> {
  private logger = createLogger("email-service");
  private logContext: Record<string, any> = {};

  async fetch(request: Request): Promise<Response> {
    this.logger.info("Received fetch request");

    try {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const body = await request.json() as EmailRequest;
      const result = await this.sendEmail(body);

      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
        status: result.success ? 200 : 500,
      });
    } catch (error) {
      this.logger.error(this.logContext, `Error processing request: ${error}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            message: "Failed to process request",
            details: error,
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 500,
        }
      );
    }
  }

  async sendEmail(request: EmailRequest): Promise<EmailResult> {
    try {
      this.logger.info(
        this.logContext,
        `Sending email for URL: ${request.data.url}`
      );

      if (!request.data || !request.data.url || !request.data.source || !request.data.phone_number) {
        this.logger.error(this.logContext, "Missing required fields in data object");
        throw new Error("Missing required fields: url, source, phone_number");
      }

      const emailResult = await this.sendEmailNotification(
        request.data.url,
        request.data.source,
        request.data.phone_number,
        request.data.report
      );

      return {
        success: true,
        messageId: emailResult,
      };
    } catch (error) {
      this.logger.error(this.logContext, `Error sending email: ${error}`);
      return {
        success: false,
        error: {
          message: "Failed to send email",
          details: error,
        },
      };
    }
  }

  private async sendEmailNotification(
    url: string,
    source: string,
    phoneNumber: string,
    report?: AbuseReport
  ): Promise<string> {
    try {
      // Check for Gmail SMTP credentials
      if (this.env.MAILER_SERVICE_GMAIL_USERNAME && this.env.MAILER_SERVICE_GMAIL_APP_PASSWORD) {
        this.logger.info(this.logContext, "Using Gmail SMTP with worker-mailer");
        return await this.sendViaWorkerMailer(url, source, phoneNumber, report);
      }

      throw new Error(`Gmail SMTP credentials missing. Required: MAILER_SERVICE_GMAIL_USERNAME + MAILER_SERVICE_GMAIL_APP_PASSWORD`);
    } catch (error) {
      this.logger.error(this.logContext, `Error sending email notification: ${error}`);
      throw error;
    }
  }

  private async sendViaWorkerMailer(
    url: string,
    source: string,
    phoneNumber: string,
    report?: AbuseReport
  ): Promise<string> {
    const htmlContent = this.generateEmailHTML(url, source, phoneNumber);
    const textContent = this.generateEmailText(url, source, phoneNumber);
    const xarfContent = this.generateXARF(url, source, phoneNumber, report);

    const messageId = crypto.randomUUID();

    // Connect to Gmail SMTP using worker-mailer
    const mailer = await WorkerMailer.connect({
      credentials: {
        username: this.env.MAILER_SERVICE_GMAIL_USERNAME,
        password: this.env.MAILER_SERVICE_GMAIL_APP_PASSWORD
      },
      authType: 'plain',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true // force_tls
    });

    // Send email with XARF attachment
    const result = await mailer.send({
      from: { email: this.env.MAILER_SERVICE_FROM_EMAIL },
      to: { email: this.env.MAILER_SERVICE_TO_EMAIL },
      subject: `New Alert: ${source}`,
      text: textContent,
      html: htmlContent,
      attachments: [{
        filename: 'xarf.json',
        content: xarfContent,
        contentType: 'application/json'
      }]
    });

    this.logger.info(this.logContext, `Email sent via worker-mailer successfully: ${result || messageId}`);
    return result || messageId;
  }


  private generateEmailHTML(url: string, source: string, phoneNumber: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
          Alert Notification
        </h2>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #495057; margin-top: 0;">Alert Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #dee2e6;">
              <td style="padding: 10px; font-weight: bold; color: #495057;">URL:</td>
              <td style="padding: 10px; word-break: break-all;">
                <a href="${url}" style="color: #007bff; text-decoration: none;">${url}</a>
              </td>
            </tr>
            <tr style="border-bottom: 1px solid #dee2e6;">
              <td style="padding: 10px; font-weight: bold; color: #495057;">Source:</td>
              <td style="padding: 10px;">${source}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; color: #495057;">Phone Number:</td>
              <td style="padding: 10px;">${phoneNumber}</td>
            </tr>
          </table>
        </div>
        <div style="background-color: #e7f3ff; padding: 15px; border-left: 4px solid #007bff; margin: 20px 0;">
          <p style="margin: 0; color: #495057;">
            <strong>Action Required:</strong> Please review this alert and take appropriate action.
          </p>
        </div>
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
          <p style="color: #6c757d; font-size: 12px; margin: 0;">
            This is an automated notification from the CheckMate Alert System.
          </p>
        </div>
      </div>
    `;
  }

  private generateEmailText(url: string, source: string, phoneNumber: string): string {
    return `
Alert Notification

URL: ${url}
Source: ${source}
Phone Number: ${phoneNumber}

Action Required: Please review this alert and take appropriate action.

This is an automated notification from the CheckMate Alert System.
    `;
  }



  private generateXARF(url: string, source: string, phoneNumber: string, report?: AbuseReport): string {
    const now = new Date().toISOString();

    const xarf = {
      "Feedback-Type": report?.report_type || "abuse",
      "User-Agent": "CheckMate-Mailer-Service/1.0",
      "Version": "1",
      "Source-IP": "unknown",
      "Reported-Domain": this.extractDomain(url),
      "Reported-URI": url,
      "Occurrence-Date": report?.event_time || now,
      "Report-Date": report?.report_time || now,
      "Category": report?.category || "spam",
      "Report-ID": crypto.randomUUID(),
      "Reporting-MTA": "checkmate.sg",
      "Reporter": report?.reported_from || "abuse-reporter@checkmate.sg",
      "Incidents": 1,
      "Source-Service": report?.source?.service || source,
      "Source-Phone": report?.source?.phone_number || phoneNumber,
      "Additional-Data": {
        "original-source": source,
        "original-phone": phoneNumber,
        "original-url": url,
        ...(report?.additional_data || {})
      }
    };

    return JSON.stringify(xarf, null, 2);
  }

  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return "unknown-domain";
    }
  }

}
