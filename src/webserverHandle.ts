import type { QueueManager } from "./queueManager";
import type { NextFunction, Express, Request, Response } from "express";
import type { authKeysTable } from "./Types";
import ExpressInit, { json, static as fstatic } from "express";
import { captureException, logger, setupExpressErrorHandler } from "@sentry/node";
import { randomUUID } from "crypto";
import { type DatabaseManager } from "./DatabaseManager";

type requestType = {
  from?: string,
  to: string | string[],
  subject: string,
  text?: string,
  html?: string,
}

type responseType = {
  success: true,
  reqID: string,
  message: string,
} | {
  success: false,
  message: string,
}

type localPassType = {
  userID: number
}

export class WebSrvManager {

  private pgMGR: DatabaseManager;
  private queueMGR: QueueManager;
  private express: Express;
  constructor(pgMGR: DatabaseManager, queueMGR: QueueManager) {
    this.pgMGR = pgMGR;
    this.queueMGR = queueMGR;
    this.express = ExpressInit();
  }

  setup(port: number) {
    /* Setup Routes */
    this.express.route("/")
      .get(this.Index);

    this.express.route("/requests")
      .all(json({ strict: true }))
      .all(this.authMiddleMan.bind(this))
      // .get(this.checkItemStatus) // Future Implementation: Ability to check specific item's queue status AND lastError Reason
      .post(this.SubmitQueue.bind(this));

    this.express.use("/public", fstatic("public"));

    setupExpressErrorHandler(this.express);

    this.express.listen(port, (err)=> {
      if(err) {
        captureException(err);
        return logger.error("Express server experienced error, object captured");
      }
      logger.info("Web server started normally");
    });
  }

  private async Index(req: Request, res: Response) {
    return res.status(200).send("Hello :3");
  }

  private async SubmitQueue(req: Request<null, null, requestType>, res: Response<responseType | string, localPassType>) {
    // Request Validation
    const senderAddr = process.env["SENDER_ADDR"];
    if(!req.body.from && senderAddr === null) {
      logger.warn("Key %d request missing sender's name when ENV (SENDER_ADDR) is null/empty", [res.locals.userID]);
      return res.status(422).json({
        success: false,
        message: "Server does not have configured fix address and requires 'from' field to be sent!"
      });
    }

    if(!req.body.subject) {
      logger.warn("Key %d request missing subject", [res.locals.userID]);
      return res.status(422).json({
        success: false,
        message: "Missing subject field. For higher deliverability, this is required!"
      });
    }

    if(!req.body.text && !req.body.html) {
      logger.warn("Key %d request missing text/html email body", [res.locals.userID]);
      return res.status(422).json({
        success: false,
        message: "You need at least one body content type (text or html) :'("
      });
    }

    if(req.body.text && req.body.html) {
      logger.warn("Key %d request contains both text/html email body", [res.locals.userID]);
      return res.status(422).json({
        success: false,
        message: "You cant have both text and html body, which one am I suppose to use?? >:{"
      });
    }

    // Assuming it's formatted 'Name <email@address.local>', we'll only pull the Name part out

    const fromName = req.body.from?.split("<")[0].trim() ?? "noreply";
    const fromSender = senderAddr ? `${fromName} <${senderAddr}>` : req.body.from;

    // Format Recipient data if the given req is string
    const recipients = (typeof(req.body.to) === "string") ? req.body.to.split(",") : req.body.to;

    const reqID = randomUUID();
    for(const recipient of recipients)
      await this.queueMGR.queueMail(res.locals.userID, {
        from: fromSender!,
        to: recipient,
        subject: req.body.subject,
        text: req.body.text,
        html: req.body.html
      }, reqID);

    logger.info("Key %d successfully queued email to %d recipients Req ID: %s", [res.locals.userID, recipients.length, reqID]);
    return res.status(200).json({
      success: true,
      reqID: reqID,
      message: "Email successfully queued!"
    });
  }

  private async authMiddleMan(req: Request<null, null, requestType>, res: Response<responseType | string, localPassType>, next: NextFunction) {
    const tokenHead = req.headers["authorization"]?.split(" ");

    if(!tokenHead || tokenHead.length !== 2) {
      logger.warn("Attempt to access service with missing authorization header");
      return res.status(401).send("Unauthorized >:{");
    }

    // Spec required capitalization but we'll lax it
    const tokenType = tokenHead[0].toLowerCase();
    const tokenKey = tokenHead[1].toLowerCase();

    if(tokenType !== "bearer") {
      logger.warn("Attempt to access service with invalid token prefix");
      return res.status(401).send("Forgot the 'Bearer' key type :/");
    }

    // Check Authorization DB
    const QRes = await this.pgMGR.pgClient.query<authKeysTable>("SELECT * from authKeys WHERE code=$1", [tokenKey]);
    if(QRes.rows.length === 0) {
      logger.warn("Attempt to access service with invalid token: $s", [tokenKey]);
      return res.status(401).send("Unauthorized >:{");
    }

    const banRes = QRes.rows[0].ban;
    if(banRes) {
      logger.warn("Attempt to access service with banned token: $s", [tokenKey]);
      return res.status(403).send(`You've been banned from accessing service: ${banRes}`);
    }

    // Pass information and complete the request
    res.locals.userID = QRes.rows[0].id;
    next();
  }
}