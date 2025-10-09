type sendMailOpt = {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

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

  async sendMail(opt: sendMailOpt): Promise<mailResType> {
    // Validation
    if(!opt.text && !opt.html)
      throw new MailServiceExcept("sendMail missing both text and html");
    if(opt.text && opt.html)
      throw new MailServiceExcept("sendMail contains both text and html value, only one of them is allowed!");

    return await (await this.transport("/requests", "POST", JSON.stringify(opt))).json();
  }

  private async transport(path: string, method: string, jsonData?: string) {
    return await fetch(`${jsonData}${path}`,{
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: jsonData
    });

  }
}

export class MailServiceExcept extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailService Error";
  }
}