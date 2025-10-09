import type { Client } from "pg";
import type { QueueManager } from "./queueManager";
import type { NextFunction, Express, Request, Response } from "express";
import type { authKeysTable } from "./Types";
import ExpressInit from "express";
import { captureException, logger } from "@sentry/node-core";

type requestType = {
  from: string,
  to: string,
  subject: string,
  text?: string,
  html?: string,
}

type responseType = {
  success: boolean,
  message: string,
}

type localPassType = {
  userID: number
}

export class WebSrvManager {

  private pgClient: Client;
  private queueMGR: QueueManager;
  private express: Express;
  constructor(pgClient: Client, queueMGR: QueueManager) {
    this.pgClient = pgClient;
    this.queueMGR = queueMGR;
    this.express = ExpressInit();
  }

  setup(port: number) {
    /* Setup Routes */
    this.express.route("/requests")
      .all(this.authMiddleMan)
      .post(this.SubmitQueue);


    this.express.listen(port, (err)=> {
      if(err) {
        captureException(err);
        return logger.error("Express server experienced error, object captured");
      }
      logger.info("Web server started normally");
    });
  }

  private async SubmitQueue(req: Request, res: Response) {

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

    if(tokenType !== "Bearer") {
      logger.warn("Attempt to access service with invalid token prefix");
      return res.status(401).send("Forgot the 'Bearer' key type :/");
    }

    // Check Authorization DB
    const QRes = await this.pgClient.query<authKeysTable>("SELECT * from authKeys WHERE code=$1", [tokenKey]);
    if(QRes.rows.length === 0) {
      logger.warn("Attempt to access service with invalid token: $s", [tokenKey]);
      return res.status(401).send("Unauthorized >:{");
    }

    // Pass information and complete the request
    res.locals.userID = QRes.rows[0].id;
    next();
  }
}