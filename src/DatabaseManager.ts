import { captureCheckIn, logger, } from "@sentry/node";
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { schedule } from "node-cron";
import type { requestsTable } from "./Types";

export class DatabaseManager {
  private _pgPool: Pool;
  private _isConnected: boolean;
  constructor(PgConnStr: string) {
    this._isConnected = false;
    this._pgPool = new Pool({
      connectionString: PgConnStr,
      max: 5,
      idleTimeoutMillis: 90000, // 1.5 minutes
      connectionTimeoutMillis: 10000, // 10 seconds
    });

    // Internal Connection Health Check
    schedule("50 23 * * *", this.cleanOldJob.bind(this));
  }

  get pgPool() {
    return this._pgPool;
  }

  get isConnected() {
    return this._isConnected;
  }

  // Timeout handled query
  async query<T extends QueryResultRow>(query: string, param?: unknown[]): Promise<QueryResult<T> | undefined> {
    try {
      const res = await this._pgPool.query<T>(query, param);
      this._isConnected = true;
      return res;
    } catch(ex) {
      if(ex instanceof Error && ex.message.includes("ETIMEDOUT")) {
        this._isConnected = false;
        return;
      }
      throw ex;
    }
  }

  // Handler to (cron) clean-up job
  private async cleanOldJob() {
    const chkID = captureCheckIn({
      monitorSlug: "clean-old-jobs",
      status: "in_progress"
    });

    logger.info("cleanOldJob: Starting...");
    const qRes = await this.query<requestsTable>("DELETE FROM requests WHERE fulfilled < now() - interval '1 month'");
    if(!qRes)
      return logger.warn("Fail to clean up old job due to database downtime");

    logger.info("Cleaned up %s requests (at least 1 month old)", [qRes.rowCount?.toString() ?? "null"]);

    captureCheckIn({
      checkInId: chkID,
      monitorSlug: "chkID",
      status: "ok"
    });
  }

}