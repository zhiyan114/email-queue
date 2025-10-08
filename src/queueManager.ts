import { createTransport, type Transporter } from "nodemailer";
import { type Channel, type ChannelWrapper, connect } from "amqp-connection-manager";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { type IAmqpConnectionManager } from "amqp-connection-manager/dist/types/AmqpConnectionManager";
import { logger, cron } from "@sentry/node-core";
import type { sendMailOpt, requestsTable } from "./Types";
import type { Client } from "pg";
import nCron from "node-cron";




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
  private sendCh?: ChannelWrapper;
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
    this.sendCh = this.amqpCli.createChannel({
      json: false,
      setup: async (ch: Channel) => await ch.assertQueue(this.queueName, { durable: true })
    });

    /* Consumer Threads */

    /* Cron Jobs */

    // Retry failed email job ever 1 hour
    cron.instrumentNodeCron(nCron).schedule("0 * * * *", this.queueFailJob.bind(this), { name: "ReQueueFailTask" });

    /* Events */
    this.amqpCli.on('connect', async() => {
      // Requeue missing request during AMQP downtime
      await this.sendCh?.waitForConnect();
      logger.info("AMQP Server Reconnected, adding %d items (in memory) to queue", [this.tempStorage.length]);

      let req;
      while((req = this.tempStorage.pop()) !== undefined)
        this.sendCh?.sendToQueue(this.queueName, req);
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
  private workerQueue() {

  }

  // Handler to (cron) requeue failed job
  private async queueFailJob() {
    const res = await this.pgClient.query<requestsTable>("SELECT * FROM requests WHERE fulfilled IS NULL");
    if(res.rowCount === 0)
      return;

    for(const item of res.rows)
      this.enque(item.id);
  }

  // Actually queue the item
  private enque(id: number) {
    if(!this.amqpCli?.isConnected())
      return this.tempStorage.push(id);
    this.sendCh?.sendToQueue(this.queueName, id);
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

/*
this.mailTransport.sendMail({
      from: opt.from,
      to: opt.to,
      subject: opt.subject,
      text: opt.text,
      html: opt.html
    });
    */