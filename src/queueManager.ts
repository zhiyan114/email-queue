import { createTransport, type Transporter } from "nodemailer";
import { type Channel, type ChannelWrapper, connect } from "amqp-connection-manager";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { type IAmqpConnectionManager } from "amqp-connection-manager/dist/types/AmqpConnectionManager";
import { logger, cron, captureException } from "@sentry/node";
import type { sendMailOpt, requestsTable } from "./Types";
import nCron from "node-cron";
import { type ConsumeMessage } from "amqplib";
import { randomUUID } from "crypto";
import { type DatabaseManager } from "./DatabaseManager";


export class QueueManager {
  private queueName: string;
  private mailTransport?: Transporter<SMTPTransport.SentMessageInfo>;
  private amqpCli?: IAmqpConnectionManager;
  private tempStorage: number[];
  private channel?: ChannelWrapper;
  private pgMGR: DatabaseManager;

  constructor(pgMGR: DatabaseManager, queueName?: string) {
    // Used to store queue item in-case of AMQP downtime
    this.tempStorage = [];
    this.queueName = queueName ?? "email";
    this.pgMGR = pgMGR;
  }

  setup(smtpAuthStr: string, amqpAuthStr: string) {
    logger.info("Initialized queue Manager. Queue Name: %s", [this.queueName]);
    this.mailTransport = createTransport(smtpAuthStr, { secure: true });
    this.amqpCli = connect(amqpAuthStr);
    this.channel = this.amqpCli.createChannel({
      json: false,
      setup: async (ch: Channel) => await ch.assertQueue(this.queueName, { durable: true })
    });

    /* Consumer Handler */

    // @NOTE: Implement more and use worker thread if queue grows...
    this.channel.consume(this.queueName, this.processQueue.bind(this), { prefetch: 3 });

    /* Cron Jobs */

    // Retry failed email job ever 1 hour
    const mainCron = cron.instrumentNodeCron(nCron);
    mainCron.schedule("0 * * * *", this.queueFailJob.bind(this), { name: "requeue-failed-jobs" });
    mainCron.schedule("0 0 * * *", this.cleanOldJob.bind(this), { name: "clean-old-jobs" });

    /* Events */

    // Requeue Items
    this.amqpCli.on('connect', async() => {
      // Requeue missing request during AMQP downtime
      await this.channel?.waitForConnect();
      logger.info("AMQP Server Reconnected, adding %d items (in memory) to queue", [this.tempStorage.length]);

      let req;
      while((req = this.tempStorage.pop()) !== undefined)
        this.channel?.sendToQueue(this.queueName, req);
    });
  }

  async queueMail(key_id: number, opt: sendMailOpt, req_id?: string) {
    // Extra checks, but webserver should handle those before reaching here
    this.checkInit();
    if(!opt.text && !opt.html)
      throw new QMGRExcept("Request missing either html or plaintext format");
    if(opt.text && opt.html)
      throw new QMGRExcept("Request cannot include both text and html format");

    // Add request to database
    const res = await this.pgMGR.query<requestsTable>("INSERT INTO requests (key_id, req_id, mail_from, mail_to, mail_subject, mail_text, mail_html) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *", [
      key_id,
      req_id ?? randomUUID(),
      opt.from,
      opt.to,
      opt.subject,
      opt.text,
      opt.html
    ]);

    // Item to queue
    this.enque(res.rows[0].id);
    return res;
  }

  // Handler to process SMTP mail transport
  private async processQueue(req: ConsumeMessage) {
    this.checkInit();

    try {
      const id = Number(req.content.toString("utf-8"));
      const qData = await this.pgMGR.query<requestsTable>("SELECT * FROM requests WHERE id=$1", [id]);

      if(qData.rows.length === 0) {
        logger.error("Attempt to process request (%d) that exist in queue but not in the database", [id]);
        this.channel?.nack(req, false, false);
        return;
      }

      const mailRes = await this.sendMail(qData.rows[0]);
      if(mailRes instanceof Error) {
        if(mailRes.message.toLowerCase() === "connection timeout") {
          logger.warn("Mail Server timed out while attempting to process: %d", [id]);
          return this.channel?.nack(req, false, false);
        }
        // Remote Mail Server reject request and should not be retried!
        logger.warn("Mail server unable to send mail to this request (and will not be retried): %d (Reason: %s)", [id, mailRes.message]);
        await this.pgMGR.query("UPDATE requests SET fulfilled=$1, lasterror=$2 WHERE id=$3", [new Date().toISOString(), mailRes.message, id]);
        return this.channel?.nack(req, false, false);
      }

      // Check transit status
      if(!mailRes || mailRes.accepted.length < 1) {
        logger.error("sendMail reported failed mail transit", {
          mailObject: mailRes ? JSON.stringify(mailRes) : "undefined"
        });
        return this.channel?.nack(req, false, false);
      }

      logger.info("Mail %d has been successfully sent to the dest server", [id]);

      const time = new Date().toISOString();
      const qUdRes = await this.pgMGR.query("UPDATE requests SET fulfilled=$1 WHERE id=$2", [time, id]);

      if(!qUdRes.rowCount || qUdRes.rowCount < 1) {
        logger.warn("Mail request has been fulfilled but database failed to update 'fulfilled' column for $d (TS: %s)", [id, time]);
        return this.channel?.nack(req, false, false);
      }

      return this.channel?.ack(req, false);
    } catch(ex) {
      captureException(ex);
      this.channel?.nack(req, false, false);
    }
  }

  // Handler to (cron) requeue failed job
  private async queueFailJob() {
    this.checkInit();

    const res = await this.pgMGR.query<requestsTable>("SELECT * FROM requests WHERE fulfilled IS NULL");
    if(res.rows.length === 0)
      return;

    logger.info("Requeue %d failed jobs!", [res.rows.length]);
    for(const item of res.rows)
      this.enque(item.id);
  }

  // Handler to (cron) clean-up job
  private async cleanOldJob() {
    const qRes = await this.pgMGR.query<requestsTable>("DELETE FROM requests WHERE fulfilled < now() - interval '1 month'");
    logger.info("Cleaned up %d requests (at least 1 month old)", [qRes.rowCount]);
  }

  // Actually queue the item
  private enque(id: number) {
    if(!this.amqpCli?.isConnected()) {
      logger.warn("item %d is currently in temp storage: AMQP server not connected", [id]);
      return this.tempStorage.push(id);
    }
    this.channel?.sendToQueue(this.queueName, id.toString());
  }

  // Ensures setup is called for required method
  private checkInit() {
    if(!this.mailTransport)
      throw new QMGRExcept("Missing transport, didnt setup?");
    if(!this.amqpCli)
      throw new QMGRExcept("Missing amqpCli, didnt setup?");
  }

  // Mailer method (to ensure mailing error are handled in a special case)
  private async sendMail(req: requestsTable) {
    try {
      return await this.mailTransport?.sendMail({
        from: req.mail_from,
        to: req.mail_to,
        subject: req.mail_subject,
        text: req.mail_text,
        html: req.mail_html
      });
    } catch(ex) {
      if(ex instanceof Error)
        return ex;
      captureException(ex);
    }
  }
}

class QMGRExcept extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueManager Error";
  }
}