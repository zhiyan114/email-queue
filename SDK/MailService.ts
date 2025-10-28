type sendMailOpt = {
  from?: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
} & (
  { text: string; html?: never } |
  { html: string; text?: never }
)

export type mailResType = {
  success: true,
  reqID: string,
  message: string,
} | {
  success: false,
  message: string,
}

export class MailService {
  private baseUrl = "https://api.mail.zhiyan114.com";
  private apiKey: string;
  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    if(baseUrl)
      this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  }

  async sendMail(opt: sendMailOpt): Promise<mailResType | string> {
    // Validation
    if(!opt.text && !opt.html)
      throw new MailServiceExcept("sendMail missing both text and html");
    if(opt.text && opt.html)
      throw new MailServiceExcept("sendMail contains both text and html value, only one of them is allowed!");
    
    opt.to = (typeof(opt.to) === "string") ? opt.to.split(",") : opt.to;

    // Email Validation
    if(opt.from && !this.validateEmail(opt.from))
      throw new MailServiceExcept("'from' field failed validation")
    for(const to of opt.to)
      if(!this.validateEmail(to))
        throw new MailServiceExcept("one of the (only) 'to' field failed validation")

    const res = await this.transport("/requests", "POST", JSON.stringify(opt))
    return res.status === 200 ? await res.json() : await res.text();
  }

  private async transport(path: string, method: string, jsonData?: string) {
    return await fetch(`${this.baseUrl}${path}`,{
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: jsonData
    });
  }

  private validateEmail(input: string) {
    // Check "Name <email@address.local>"
    if(/^[a-zA-Z0-9 ._'`-]+ <[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}>$/.test(input))
      return true;

    // Check "email@address.local"
    if(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(input))
      return true;

    return false;
  }
}

export class MailServiceExcept extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailService Error";
  }
}