export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  url: string;
}

export interface Mailer {
  send(msg: EmailMessage): Promise<void>;
}

/** Dev/test transport: logs the link. MUST NOT be used in production. */
export const consoleMailer: Mailer = {
  async send({ to, url }) {
    console.log(`[auth] email to ${to}: ${url}`);
  },
};
