import type { QueueManager } from "./queueManager";
import type { NextFunction, Express, Request, Response } from "express";
import type { requestsTable, authKeysTable, requestType, responseType, localPassType, requestGETResType } from "./Types";
import ExpressInit, { json, static as fstatic } from "express";
import { captureException, logger, setupExpressErrorHandler } from "@sentry/node";
import { randomUUID } from "crypto";
import { type DatabaseManager } from "./DatabaseManager";

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
      .post(this.SubmitQueue.bind(this));
    this.express.get('/requests/:reqID', this.authMiddleMan.bind(this), this.checkItemStatus.bind(this));

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

  private async checkItemStatus(req: Request<{reqID: string}, null, requestType>, res: Response<requestGETResType | string, localPassType>) {
    logger.info("Key %d requested record for request: %s", [res.locals.userID, req.params.reqID]);
    const qRes = await this.pgMGR.query<requestsTable>("SELECT * FROM requests WHERE key_id=$1 AND req_id=$2", [res.locals.userID, req.params.reqID]);
    if(!qRes)
      return res.status(503).send("Database is currently down, no request can be fulfilled at this time!");

    return res.send({
      emails: qRes.rows.map(data => ({
        id: data.id,
        fulfilled: data.fulfilled?.toString() ?? null,
        lasterror: data.lasterror ?? null
      }))
    });
  }

  private async SubmitQueue(req: Request<null, null, requestType>, res: Response<responseType | string, localPassType>) {
    // Request Validation
    if(!req.body.from) {
      logger.warn("Key %d request missing sender's name/email", [res.locals.userID]);
      return res.status(422).json({
        success: false,
        message: "Missing 'from' field."
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

    // ReplyTo email validation
    const ReplyTo = typeof(req.body.replyto) === "string" ? req.body.replyto.split(",") : req.body.replyto;
    if(ReplyTo)
      for(const repTo of ReplyTo)
        if(!this.validateEmail(repTo)) {
          logger.warn("Key %d request contains invalid ReplyTo Address", [res.locals.userID]);
          return res.status(422).json({
            success: false,
            message: "One of your (only) 'replyto' field is invalid"
          });
        }

    // Email format validations
    if(!this.validateEmail(req.body.from)) {
      logger.warn("Key %d request contains invalid 'from' email format: %s", [res.locals.userID, req.body.from]);
      return res.status(422).json({
        success: false,
        message: "Your 'from' email is not in the right format >:{"
      });
    }

    // Recipient format validations
    const recipients = (typeof(req.body.to) === "string") ? req.body.to.split(",") : req.body.to;
    for(const recipient of recipients)
      if(!this.validateEmail(recipient)) {
        logger.warn("Key %d request contains invalid 'to' email format: %s", [res.locals.userID, req.body.from]);
        return res.status(422).json({
          success: false,
          message: "One of your (only) 'to' email has invalid format >:{"
        });
      }

    const reqID = randomUUID();
    let failReq = 0;
    for(const recipient of recipients) {
      const fail = await this.queueMGR.queueMail(res.locals.userID, {
        ...req.body,
        to: recipient,
        replyto: ReplyTo,
      }, reqID);
      if(!fail) {
        logger.error("Failed to queue one of the request from %s due to bad DB connection", [reqID]);
        failReq++;
      }
    }

    logger.info("Key %d successfully queued email to %d recipients Req ID: %s", [res.locals.userID, recipients.length - failReq, reqID]);
    return res.status(200).json({
      success: true,
      reqID: reqID,
      message: "Email successfully queued!"
    });
  }

  private async authMiddleMan(req: Request<unknown, null, requestType>, res: Response<responseType | string | unknown, localPassType>, next: NextFunction) {
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
    const QRes = await this.pgMGR.query<authKeysTable>("SELECT * from authKeys WHERE code=$1", [tokenKey]);
    if(!QRes)
      return res.status(503).json({
        success: false,
        message: "Database is current down, try again later!"
      });

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