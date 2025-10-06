import { createTransport, type Transporter } from "nodemailer";
import { type Channel, connect, type ChannelModel } from "amqplib";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export type sendMailOpt = {
  from: string;
  to: string;
  subject?: string;
  text?: string;
  html?: string;
}

/*
@TODO:
- Handle closed AMQP connection and queue content into tempStorage until connection is up
- Handle publish/consumer channel status as well to determine if re-initialization for those
*/

export class QueueManager {
  private queueName: string;
  private mailTransport?: Transporter<SMTPTransport.SentMessageInfo>;
  private amqpCli?: ChannelModel;
  private tempStorage: number[];
  private sendQCh?: Channel;

  constructor(queueName?: string) {
    // Used to store queue item in-case of AMQP downtime
    this.tempStorage = [];
    this.queueName = queueName ?? "email";
  }

  async setup(smtpAuthStr: string, amqpAuthStr: string) {
    this.mailTransport = createTransport(smtpAuthStr);
    this.amqpCli = await connect(amqpAuthStr);
    this.sendQCh = await this.amqpCli.createChannel();
    await this.sendQCh.assertQueue(this.queueName);
  }

  async queueMail(opt: sendMailOpt) {
    // Extra checks, but webserver should handle those before reaching here
    this.checkInit();
    if(!opt.text || !opt.html)
      throw new QMGRExcept("Request missing either html or plaintext format");
    if(opt.text && opt.html)
      throw new QMGRExcept("Request cannot include both text and html format");


  }

  // Multithreaded Queue Consumer
  private workerQueue() {

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