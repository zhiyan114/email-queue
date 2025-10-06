import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

// REST ENDPOINT EXPECTED TYPE
export type sendMailOpt = {
  from: string;
  to: string;
  subject?: string;
  text?: string;
  html?: string;
}

export class MailManager {
  private mailTransport?: Transporter<SMTPTransport.SentMessageInfo>;

  get transport() {
    return this.mailTransport;
  }

  login(authString: string) {
    this.mailTransport = createTransport(authString);
  }

  sendMail(opt: sendMailOpt) {
    // Extra checks, but webserver should handle those before reaching here
    if(!this.mailTransport)
      throw new MailMGRExcept("Missing transport, didnt login?");
    if(!opt.text || !opt.html)
      throw new MailMGRExcept("Request missing either html or plaintext format");
    if(opt.text && opt.html)
      throw new MailMGRExcept("Request cannot include both text and html format");

    return this.mailTransport.sendMail({
      from: opt.from,
      to: opt.to,
      subject: opt.subject,
      text: opt.text,
      html: opt.html
    });
  }
}

class MailMGRExcept extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailManager Error";
  }
}