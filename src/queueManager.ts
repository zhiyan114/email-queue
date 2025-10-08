import { createTransport, type Transporter } from "nodemailer";
import { type Channel, type ChannelWrapper, connect } from "amqp-connection-manager";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { type IAmqpConnectionManager } from "amqp-connection-manager/dist/types/AmqpConnectionManager";
import { logger, cron, captureException } from "@sentry/node-core";
import type { sendMailOpt, requestsTable } from "./Types";
import type { Client } from "pg";
import nCron from "node-cron";
import { type ConsumeMessage } from "amqplib";




/*
@TODO:
- Handle closed AMQP connection and queue content into tempStorage until connection is up
- Handle publish/consumer channel status as well to determine if re-initialization for those
*/

export class QueueManager {
  private queueName: string;
  private mailTransport?: Transporter<SMTPTransport.SentMessageInfo>;
  private amqpCli?: IAmqpConnectionManager;
  private tempStorage: number[];
  private channel?: ChannelWrapper;
  private pgClient: Client;

  constructor(pgClient: Client, queueName?: string) {
    // Used to store queue item in-case of AMQP downtime
    this.tempStorage = [];
    this.queueName = queueName ?? "email";
    this.pgClient = pgClient;
  }

  setup(smtpAuthStr: string, amqpAuthStr: string) {
    logger.info("Initialized queue Manager. Queue Name: %s", [this.queueName]);
    this.mailTransport = createTransport(smtpAuthStr);
    this.amqpCli = connect(amqpAuthStr);
    this.channel = this.amqpCli.createChannel({
      json: false,
      setup: async (ch: Channel) => await ch.assertQueue(this.queueName, { durable: true })
    });

    /* Consumer Handler */

    // @NOTE: Implement more and use worker thread if queue grows...
    this.channel.consume(this.queueName, this.processQueue, { prefetch: 10 });

    /* Cron Jobs */

    // Retry failed email job ever 1 hour
    cron.instrumentNodeCron(nCron).schedule("0 * * * *", this.queueFailJob.bind(this), { name: "ReQueueFailMail" });

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

  async queueMail(key_id: number, opt: sendMailOpt) {
    // Extra checks, but webserver should handle those before reaching here
    this.checkInit();
    if(!opt.text || !opt.html)
      throw new QMGRExcept("Request missing either html or plaintext format");
    if(opt.text && opt.html)
      throw new QMGRExcept("Request cannot include both text and html format");

    // Add request to database
    const res = await this.pgClient.query<requestsTable>("INSERT INTO requests (key_id, mail_from, mail_to, mail_subject, mail_text, mail_html) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *", [
      key_id,
      opt.from,
      opt.to,
      opt.subject,
      opt.text,
      opt.html
    ]);

    // Item to queue
    this.enque(res.rows[0].id);
  }

  // Handler to process SMTP mail transport
  private async processQueue(req: ConsumeMessage) {
    this.checkInit();

    try {
      const id = Number(req.content.toString("utf-8"));
      const qData = await this.pgClient.query<requestsTable>("SELECT * FROM requests WHERE id=$1", [id]);

      if(qData.rows.length === 0) {
        logger.error("Attempt to process request (%d) that exist in queue but not in the database", [id]);
        this.channel?.nack(req, false, false);
        return;
      }

      const mailRes = await this.mailTransport?.sendMail({
        from: qData.rows[0].mail_from,
        to: qData.rows[0].mail_to,
        subject: qData.rows[0].mail_subject,
        text: qData.rows[0].mail_text,
        html: qData.rows[0].mail_html
      });

      // Check transit status
      if(!mailRes || mailRes.accepted.length < 1) {
        logger.error("sendMail reported failed mail transit", {
          mailObject: mailRes ? JSON.stringify(mailRes) : "undefined"
        });
        return this.channel?.nack(req, false, false);
      }

      logger.info("Mail %d has been successfully sent to the dest server", [id]);

      const time = Date.now();
      const qUdRes = await this.pgClient.query("UPDATE requests SET fulfilled=$1 WHERE id=$2", [time, id]);

      if(!qUdRes.rowCount || qUdRes.rowCount < 1) {
        logger.warn("Mail request has been fulfilled but database failed to update 'fulfilled' column for $d (TS: %s", [id, time.toString()]);
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
    const res = await this.pgClient.query<requestsTable>("SELECT * FROM requests WHERE fulfilled IS NULL");
    if(res.rows.length === 0)
      return;

    logger.info("Requeue %d failed jobs!", [res.rows.length]);
    for(const item of res.rows)
      this.enque(item.id);
  }

  // Actually queue the item
  private enque(id: number) {
    if(!this.amqpCli?.isConnected())
      return this.tempStorage.push(id);
    this.channel?.sendToQueue(this.queueName, id.toString());
  }

  // Ensures setup is called for required method
  private checkInit() {
    if(!this.mailTransport)
      throw new QMGRExcept("Missing transport, didnt setup?");
    if(!this.amqpCli)
      throw new QMGRExcept("Missing amqpCli, didnt setup?");
  }
}

class QMGRExcept extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueManager Error";
  }
}