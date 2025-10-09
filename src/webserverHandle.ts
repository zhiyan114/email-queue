import type { Client } from "pg";
import type { QueueManager } from "./queueManager";
import type { NextFunction, Express, Request, Response } from "express";
import ExpressInit from "express";
import { captureException, logger } from "@sentry/node-core";

type requestType = {

}

type responseType = {

}

type paramPassThrType = {
  id: number
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

  private async authMiddleMan(req: Request<null,requestType, responseType, null, paramPassThrType>, res: Response, next: NextFunction) {
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
  }
}