export type sendMailOpt = {
  from: string;
  to: string;
  subject?: string;
  text?: string;
  html?: string;
}

export type authKeyTable = {
  id: number,
  code: string,
  ban?: string,
}

export type requestsTable = {
  id: number,
  key_id: number,
  mail_from: string,
  mail_to: string,
  mail_subject: string,
  mail_text?: string,
  mail_html?: string,
  fulfilled?: Date,
}
